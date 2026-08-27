import { supabase } from './supabase'
import { sendSlackAlert } from '../tools/slack'
import { sendPlainEmail, gmailConnected, sendPlatformEmail, platformGmailConnected, type EmailAttachment } from './gmail'
import { buildEmail, type EmailBrand, type EmailRow } from './email-template'
import { logoUrl } from './widget-logo'
import type { Client } from '@agent-platform/shared'

// Prefix + header let a client auto-file these with a one-time Gmail filter
// (e.g. "subject contains [Website Chat] → label Chatbot").
const SUBJECT_PREFIX = '[Website Chat]'

export interface EscalationInput {
  from: string          // visitor's email (or session id)
  name?: string
  message: string       // what the visitor said / wants
  reason: string        // why it's being escalated
  channel: 'chat' | 'contact_form' | 'roi-calculator'
  // Only present for clients whose widgetConfig.contactFields opted into these.
  company?: string
  phone?: string
  division?: string
  // Extra labeled rows for the notification email, e.g. the ROI calculator's
  // inputs/results. Rendered between the contact rows and the Reason row.
  details?: EmailRow[]
  // Attached to the notification email (e.g. the ROI summary PDF the visitor
  // downloaded). Never persisted — email-only.
  attachments?: EmailAttachment[]
}

// Chat escalations pass the widget's session id as `from` (sess_<rand>) —
// only contact-form submissions carry a real address. Everything that treats
// `from` as contactable has to check first, or a salesperson ends up hitting
// Reply to "sess_a1b2c3".
function asEmail(value: string): string | null {
  const trimmed = value.trim()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null
}

function brandFor(client: Client): EmailBrand {
  const widget = client.widgetConfig ?? {}
  const businessName = widget.title || client.name
  return {
    businessName,
    color: widget.color || '',           // template falls back to its default
    // An uploaded logo is served from our own origin as an absolute URL; a
    // manually-entered one is already absolute. Either way it must be publicly
    // reachable, since an email client fetches it with no session.
    logoUrl: widget.logoPath ? logoUrl(client.id) : widget.logo
    // No `label` on purpose: the template's generic "Chat Assistant" default
    // is exactly what's wanted here — the client asked that no company name
    // ever appear in the bar (their logo already carries the identity), so
    // never prefix the business name onto it.
  }
}

// Notifies a human that the chatbot needs a person: records the escalation,
// pings Slack, and emails the client's escalation address. Each channel is
// best-effort — one failing never blocks the others.
export async function notifyEscalation(client: Client, input: EscalationInput): Promise<void> {
  const cfg = client.agentConfig ?? ({} as Client['agentConfig'])
  const visitorEmail = asEmail(input.from)
  // A contact-form submission or a calculator download is someone asking to
  // be contacted — that's a lead. A chat escalation is the bot getting stuck.
  // Same plumbing, but the salesperson opening it should immediately know
  // which one they've got.
  const isLead = input.channel !== 'chat'
  const isRoi = input.channel === 'roi-calculator'

  // 1. Record it (also powers the dashboard "open escalations" stat). An ROI
  // calculator download is NOT an escalation — it already exists as a lead
  // row, and an open-escalation per PDF download would just be noise to
  // resolve — so only conversation-driven channels record one.
  // Note: the escalations table's required address column is `from_email`.
  if (!isRoi) await supabase.from('escalations').insert({
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
      reason: input.reason,
      visitorEmail,
      isLead,
      company: input.company,
      phone: input.phone,
      division: input.division
    })
  } catch (err) {
    console.error('[escalation] slack failed', err)
  }

  // 3. Email the human, clearly marked. Prefer the client's OWN connected
  // Gmail (their branding, their sender identity) — but not every client
  // connects Gmail, especially a freshly onboarded one, and escalation email
  // is core product behavior, not optional. So it falls back to the
  // platform's own Gmail (see lib/gmail.ts's sendPlatformEmail) rather than
  // silently dropping the email. This is a direct send, deliberately NOT
  // routed through sendGuardedEmail: that guardrail's test-mode redirect
  // exists for platform-INITIATED bulk email (reports, notifications) where
  // misfiring is a reputational risk — a live visitor's escalation must reach
  // the real client inbox in production, the same way it already does when
  // sent via the client's own Gmail.
  // Leads (contact form, chatbot capture, ROI calculator) go to the lead
  // recipients (escalationEmail — comma-separated list, dashboard-managed).
  // Support escalations prefer the dedicated supportEmail when one is set
  // (e.g. Spec-ID routes "couldn't answer" hand-offs to contact@spec-id.com)
  // and fall back to the lead recipients otherwise.
  const to = isLead ? cfg.escalationEmail : (cfg.supportEmail || cfg.escalationEmail)
  if (to) {
    const who = input.name || visitorEmail || 'A website visitor'
    // Subjects are read in a crowded inbox list, so they lead with what
    // happened and who it was — not an opaque reason code and a session id.
    // The bracketed prefix names the SOURCE so a one-time Gmail filter can
    // file each stream separately.
    const subject = isRoi
      ? `[ROI Calculator] New lead — ${who}`
      : isLead
        ? `${SUBJECT_PREFIX} New lead — ${who}`
        : `${SUBJECT_PREFIX} Needs a human — ${who}`

    const rows: EmailRow[] = [{ label: 'From', value: input.name || visitorEmail || 'Anonymous visitor' }]
    if (visitorEmail) rows.push({ label: 'Email', value: visitorEmail, href: `mailto:${visitorEmail}` })
    if (input.company) rows.push({ label: 'Company', value: input.company })
    if (input.phone) rows.push({ label: 'Phone', value: input.phone, href: `tel:${input.phone}` })
    if (input.division) rows.push({ label: 'Division', value: input.division })
    if (input.details?.length) rows.push(...input.details)
    rows.push({ label: 'Reason', value: input.reason })
    rows.push({
      label: 'Source',
      value: isRoi ? 'Website ROI calculator' : isLead ? 'Website contact form' : 'Website chat'
    })
    rows.push({ label: 'Received', value: new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) })

    const { html, text } = buildEmail(brandFor(client), {
      eyebrow: isRoi ? 'New lead — ROI calculator' : isLead ? 'New lead' : 'Needs a human',
      headline: isRoi
        ? `${who} ran the ROI calculator`
        : isLead
          ? `${who} wants to hear from you`
          : `Your assistant handed off a conversation`,
      intro: isRoi
        ? 'They entered their numbers on your website, downloaded their ROI summary (attached), and left their contact details.'
        : isLead
          ? 'Someone reached out through your website and is waiting on a reply.'
          : "Your AI assistant couldn't finish this one on its own and flagged it for a person.",
      rows,
      quote: input.message?.trim() ? { title: 'What they said', text: input.message } : undefined,
      cta: visitorEmail ? { label: `Reply to ${input.name || visitorEmail}`, url: `mailto:${visitorEmail}` } : undefined,
      // The Reply-To CTA above already makes "reply reaches them" obvious;
      // only worth calling out explicitly when there's NOT a reply path.
      footerNote: visitorEmail
        ? undefined
        : "This visitor didn't leave contact details, so there's no one to reply to directly."
    })

    const sendOptions = {
      // A named sender beats a bare Gmail address in an inbox list.
      fromName: `${client.widgetConfig?.title || client.name} Assistant`,
      // The whole point: Reply reaches the prospect, not their own inbox.
      replyTo: visitorEmail ?? undefined,
      html,
      attachments: input.attachments,
      extraHeaders: { 'X-Agent-Platform-Event': isLead ? 'lead' : 'escalation' }
    }

    // Try the client's own Gmail first, but fall back to the platform's on
    // ANY failure — not just "never connected". A stale/revoked token throws
    // from inside sendPlainEmail just like a missing connection would, and a
    // client whose token quietly expired deserves the same rescue as one who
    // never connected at all, not a silently dropped email.
    let sent = false
    if (await gmailConnected(client.id)) {
      try {
        await sendPlainEmail(client.id, to, subject, text, sendOptions)
        sent = true
      } catch (err) {
        console.error(`[escalation] client Gmail send failed for ${client.id}, falling back to platform sender`, err)
      }
    }
    if (!sent) {
      try {
        if (await platformGmailConnected()) {
          await sendPlatformEmail(to, subject, text, sendOptions)
        } else {
          console.warn(`[escalation] no Gmail connected (client ${client.id} or platform) — email skipped`)
        }
      } catch (err) {
        console.error('[escalation] platform Gmail send failed too', err)
      }
    }
  }
}
