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

async function logSend(clientId: string | null, event: string, channel: 'email' | 'slack', recipient: string | null): Promise<void> {
  const { error } = await supabase.from('notification_log').insert({ client_id: clientId, event, channel, recipient })
  if (error) console.error('[notify] failed to log send', error.message)
}

export interface GuardedEmailResult {
  sent: boolean
  recipient: string | null // the address actually sent to (test-mode may redirect it)
  testMode: boolean
  reason?: 'no_sender_configured' | 'sender_not_connected' | 'daily_cap_reached'
}

// The single guardrailed email path for the whole platform. Every
// platform-sent email — change-request notifications AND reports — goes
// through here so the guardrails can't be bypassed:
//   - sends from PLATFORM_SENDER_CLIENT_ID's Gmail, never a client's own
//   - REPORT_EMAIL_TEST_MODE (default on) redirects to REPORT_TEST_INBOX
//   - a persisted daily cap across ALL platform email (notification_log)
//   - never called from any scheduler (see module header)
// Returns a result so a caller triggering a deliberate send (report send)
// can surface exactly what happened; notify() ignores it (best-effort).
export async function sendGuardedEmail(opts: {
  clientId: string | null
  event: string
  to: string
  subject: string
  body: string
}): Promise<GuardedEmailResult> {
  const testMode = EMAIL_TEST_MODE
  const senderClientId = process.env.PLATFORM_SENDER_CLIENT_ID
  if (!senderClientId) { console.warn('[notify] PLATFORM_SENDER_CLIENT_ID not set — email skipped'); return { sent: false, recipient: null, testMode, reason: 'no_sender_configured' } }
  if (!(await gmailConnected(senderClientId))) { console.warn('[notify] platform sender Gmail not connected — email skipped'); return { sent: false, recipient: null, testMode, reason: 'sender_not_connected' } }

  if ((await emailsSentToday()) >= NOTIFY_EMAIL_DAILY_CAP) {
    console.warn(`[notify] daily email cap (${NOTIFY_EMAIL_DAILY_CAP}) reached — skipping`)
    return { sent: false, recipient: null, testMode, reason: 'daily_cap_reached' }
  }

  const recipient = testMode ? (TEST_INBOX ?? opts.to) : opts.to
  if (testMode && !TEST_INBOX) console.warn('[notify] REPORT_EMAIL_TEST_MODE is on but REPORT_TEST_INBOX is unset — sending to the real recipient anyway')

  await sendPlainEmail(senderClientId, recipient, opts.subject, opts.body)
  await logSend(opts.clientId, opts.event, 'email', recipient)
  return { sent: true, recipient, testMode }
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
      await sendGuardedEmail({ clientId, event, to: settings.email_to, subject: payload.title, body: payload.body })
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
      await sendGuardedEmail({ clientId: null, event, to: superadminEmail, subject: payload.title, body: payload.body })
    } catch (err) {
      console.error('[notify] superadmin email failed', err)
    }
  }
}
