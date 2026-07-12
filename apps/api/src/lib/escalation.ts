import { supabase } from './supabase'
import { sendSlackAlert } from '../tools/slack'
import { sendPlainEmail, gmailConnected } from './gmail'
import type { Client } from '@agent-platform/shared'

// Prefix + header let a client auto-file these with a one-time Gmail filter
// (e.g. "subject contains [Website Chat] → label Chatbot").
const SUBJECT_PREFIX = '[Website Chat]'

export interface EscalationInput {
  from: string          // visitor's email (or session id)
  name?: string
  message: string       // what the visitor said / wants
  reason: string        // why it's being escalated
  channel: 'chat' | 'contact_form'
}

// Notifies a human that the chatbot needs a person: records the escalation,
// pings Slack, and emails the client's escalation address. Each channel is
// best-effort — one failing never blocks the others.
export async function notifyEscalation(client: Client, input: EscalationInput): Promise<void> {
  const cfg = client.agentConfig ?? ({} as Client['agentConfig'])

  // 1. Record it (also powers the dashboard "open escalations" stat).
  // Note: the escalations table's required address column is `from_email`.
  await supabase.from('escalations').insert({
    client_id: client.id,
    from_email: input.from,
    body: input.message,
    reason: input.reason,
    status: 'open'
  }).then(({ error }) => { if (error) console.error('[escalation] db insert failed', error.message) })

  // 2. Slack.
  try {
    await sendSlackAlert(cfg.slackWebhook, {
      clientName: client.name,
      from: input.name ? `${input.name} <${input.from}>` : input.from,
      body: input.message,
      reason: input.reason
    })
  } catch (err) {
    console.error('[escalation] slack failed', err)
  }

  // 3. Email the human (via the client's connected Gmail), clearly marked.
  if (cfg.escalationEmail) {
    if (await gmailConnected(client.id)) {
      const subject = `${SUBJECT_PREFIX} ${input.reason} — ${input.name || input.from}`
      const bodyLines = [
        `Your website chatbot escalated a conversation and needs a human.`,
        ``,
        `From:    ${input.name ? `${input.name} <${input.from}>` : input.from}`,
        `Reason:  ${input.reason}`,
        `Channel: ${input.channel}`,
        ``,
        `Message:`,
        input.message,
        ``,
        `— ${client.name} AI assistant`
      ]
      try {
        await sendPlainEmail(client.id, cfg.escalationEmail, subject, bodyLines.join('\n'), {
          'X-Agent-Platform-Event': 'escalation'
        })
      } catch (err) {
        console.error('[escalation] email failed', err)
      }
    } else {
      console.warn(`[escalation] escalationEmail set but Gmail not connected for ${client.id} — email skipped`)
    }
  }
}
