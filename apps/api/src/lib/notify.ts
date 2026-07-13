import { supabase } from './supabase'
import { sendPlainEmail, gmailConnected } from './gmail'

// Central event router for platform notifications (change requests, and
// report.ready in a later slice). Fans out to a client's configured
// channels AND to the superadmin's channels, independently — either can
// fail without affecting the other.
//
// Email guardrails exist because of a PAST INCIDENT (582 emails auto-sent to
// a real inbox from an unbounded loop): every email path here is
// event-driven (never on a timer/cron), capped per day, and defaults to a
// test inbox until deliberately turned off. See NOTIFY_EMAIL_TEST_MODE below.
// This module must never be imported by a scheduler.

export type NotifyEvent = 'request.created' | 'request.status_changed' | 'report.ready'

export interface NotifyPayload {
  title: string   // short summary line
  body: string     // longer plain-text body
}

interface NotificationSettingsRow {
  client_id: string
  email_enabled: boolean
  email_to: string | null
  slack_enabled: boolean
  slack_webhook_url: string | null
  events: Record<string, boolean>
}

async function getSettings(clientId: string): Promise<NotificationSettingsRow | null> {
  const { data, error } = await supabase.from('notification_settings').select('*').eq('client_id', clientId).maybeSingle()
  if (error) { console.error('[notify] failed to load settings', error.message); return null }
  return data as NotificationSettingsRow | null
}

export async function getNotificationSettings(clientId: string): Promise<NotificationSettingsRow> {
  const existing = await getSettings(clientId)
  return existing ?? {
    client_id: clientId, email_enabled: false, email_to: null,
    slack_enabled: false, slack_webhook_url: null, events: {}
  }
}

export async function updateNotificationSettings(
  clientId: string,
  patch: Partial<Pick<NotificationSettingsRow, 'email_enabled' | 'email_to' | 'slack_enabled' | 'slack_webhook_url' | 'events'>>
): Promise<NotificationSettingsRow> {
  const { data, error } = await supabase
    .from('notification_settings')
    .upsert({ client_id: clientId, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'client_id' })
    .select()
    .single()
  if (error) throw error
  return data as NotificationSettingsRow
}

async function postSlack(webhookUrl: string, title: string, body: string): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: title,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*${title}*` } },
        { type: 'section', text: { type: 'mrkdwn', text: body.slice(0, 500) } }
      ]
    })
  })
  if (!res.ok) throw new Error(`Slack webhook returned ${res.status}`)
}

const NOTIFY_EMAIL_DAILY_CAP = Number(process.env.NOTIFY_EMAIL_DAILY_CAP ?? 25)
// Shared with the future report-email guardrail (slice 6) — one switch for
// every platform-sent client email. Defaults ON so a misconfigured deploy
// fails toward "nothing sent to a real inbox," not the reverse.
const EMAIL_TEST_MODE = process.env.REPORT_EMAIL_TEST_MODE !== 'false'
const TEST_INBOX = process.env.REPORT_TEST_INBOX

async function emailsSentToday(): Promise<number> {
  const since = new Date(); since.setHours(0, 0, 0, 0)
  const { count, error } = await supabase
    .from('notification_log')
    .select('*', { count: 'exact', head: true })
    .eq('channel', 'email')
    .gte('created_at', since.toISOString())
  if (error) { console.error('[notify] failed to count today\'s emails', error.message); return NOTIFY_EMAIL_DAILY_CAP } // fail closed
  return count ?? 0
}

async function logSend(clientId: string | null, event: NotifyEvent, channel: 'email' | 'slack', recipient: string | null): Promise<void> {
  const { error } = await supabase.from('notification_log').insert({ client_id: clientId, event, channel, recipient })
  if (error) console.error('[notify] failed to log send', error.message)
}

// Sends one email through the guardrail: test-mode redirect + daily cap.
// PLATFORM_SENDER_CLIENT_ID must point at a client with Gmail connected —
// notifications are sent from the platform's own inbox, not a client's.
async function sendPlatformEmail(clientId: string | null, event: NotifyEvent, to: string, subject: string, body: string): Promise<void> {
  const senderClientId = process.env.PLATFORM_SENDER_CLIENT_ID
  if (!senderClientId) { console.warn('[notify] PLATFORM_SENDER_CLIENT_ID not set — email skipped'); return }
  if (!(await gmailConnected(senderClientId))) { console.warn('[notify] platform sender Gmail not connected — email skipped'); return }

  if ((await emailsSentToday()) >= NOTIFY_EMAIL_DAILY_CAP) {
    console.warn(`[notify] daily email cap (${NOTIFY_EMAIL_DAILY_CAP}) reached — skipping`)
    return
  }

  const recipient = EMAIL_TEST_MODE ? (TEST_INBOX ?? to) : to
  if (EMAIL_TEST_MODE && !TEST_INBOX) console.warn('[notify] REPORT_EMAIL_TEST_MODE is on but REPORT_TEST_INBOX is unset — sending to the real recipient anyway')

  await sendPlainEmail(senderClientId, recipient, subject, body)
  await logSend(clientId, event, 'email', recipient)
}

// Fans an event out to a client's configured channels and the superadmin's
// channels. Each channel failure is caught independently — one broken
// integration never blocks the others.
export async function notify(clientId: string, event: NotifyEvent, payload: NotifyPayload): Promise<void> {
  const settings = await getSettings(clientId)
  const eventEnabled = settings?.events?.[event] !== false // default on unless explicitly disabled

  if (settings?.slack_enabled && settings.slack_webhook_url && eventEnabled) {
    try {
      await postSlack(settings.slack_webhook_url, payload.title, payload.body)
      await logSend(clientId, event, 'slack', null)
    } catch (err) {
      console.error('[notify] client slack failed', err)
    }
  }

  if (settings?.email_enabled && settings.email_to && eventEnabled) {
    try {
      await sendPlatformEmail(clientId, event, settings.email_to, payload.title, payload.body)
    } catch (err) {
      console.error('[notify] client email failed', err)
    }
  }

  const superadminSlack = process.env.SUPERADMIN_SLACK_WEBHOOK
  if (superadminSlack) {
    try {
      await postSlack(superadminSlack, payload.title, payload.body)
      await logSend(null, event, 'slack', null)
    } catch (err) {
      console.error('[notify] superadmin slack failed', err)
    }
  }

  const superadminEmail = process.env.SUPERADMIN_NOTIFY_EMAIL
  if (superadminEmail) {
    try {
      await sendPlatformEmail(null, event, superadminEmail, payload.title, payload.body)
    } catch (err) {
      console.error('[notify] superadmin email failed', err)
    }
  }
}
