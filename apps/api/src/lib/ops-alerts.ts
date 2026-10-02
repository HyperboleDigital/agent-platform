import { sendPlatformEmail, platformGmailConnected } from './gmail'

// Operational alerts for the superadmin when the chat agent itself is broken
// (LLM provider out of credits, revoked key, provider outage). Born from the
// 2026-10-01 incident: OpenAI ran out of credits and every production chat
// returned "Agent error" for a day — discovered only because Owen happened to
// demo the widget. Visitors see the widget's fallback copy; nothing else in
// the system complains. This module is that complaint.
//
// Email goes DIRECTLY via sendPlatformEmail, not sendGuardedEmail — same
// reasoning as escalation.ts: the guardrail's test-mode redirect exists for
// platform-initiated bulk email to CLIENTS. This is a monitoring alert to the
// operator's own configured address, and a provider outage is exactly when it
// must not be swallowed by a test-mode switch.
//
// Flood control (a provider outage fails EVERY message):
//   - one email per THROTTLE_MS window; failures in between are counted and
//     reported in the next alert ("41 more failures since the last email")
//   - a hard daily email cap as a backstop against flapping
//   - Slack (superadmin webhook) gets the same throttling
// State is in-memory — single-instance deployment, same assumption as
// lib/rate-limit.ts. A process restart re-arming the alert is fine: if it's
// still broken, the next failure re-alerts, which is what you'd want anyway.

const THROTTLE_MS = 30 * 60 * 1000
const DAILY_EMAIL_CAP = 8

const state = {
  lastAlertAt: 0,
  suppressedSinceLast: 0,
  emailsToday: 0,
  emailDay: '' // YYYY-MM-DD the counter belongs to
}

function alertAddress(): string | undefined {
  return process.env.OPS_ALERT_EMAIL || process.env.SUPERADMIN_NOTIFY_EMAIL
}

async function slack(text: string): Promise<void> {
  const url = process.env.SUPERADMIN_SLACK_WEBHOOK
  if (!url) return
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    })
  } catch (err) {
    console.error('[ops-alerts] slack failed', err instanceof Error ? err.message : err)
  }
}

// Fire-and-forget from the chat route's catch block — must never throw or
// block the response. The visitor already got the fallback copy; this is
// purely about the operator finding out.
export async function alertChatFailure(opts: {
  clientId: string
  clientName?: string
  error: unknown
}): Promise<void> {
  try {
    const now = Date.now()
    if (now - state.lastAlertAt < THROTTLE_MS) {
      state.suppressedSinceLast++
      return
    }

    const today = new Date().toISOString().slice(0, 10)
    if (state.emailDay !== today) {
      state.emailDay = today
      state.emailsToday = 0
    }

    const suppressed = state.suppressedSinceLast
    state.lastAlertAt = now
    state.suppressedSinceLast = 0

    const who = opts.clientName ?? opts.clientId
    const errMsg = opts.error instanceof Error ? opts.error.message : String(opts.error)
    const summary =
      `Chat agent failure for ${who}: ${errMsg}` +
      (suppressed ? ` (${suppressed} more failure${suppressed === 1 ? '' : 's'} suppressed since the last alert)` : '')

    console.error(`[ops-alerts] ${summary}`)
    void slack(`🔴 ${summary}\nVisitors are seeing "trouble connecting". Check the LLM provider balance/key (Render → agent-platform-api → Environment).`)

    const to = alertAddress()
    if (!to) {
      console.warn('[ops-alerts] no OPS_ALERT_EMAIL / SUPERADMIN_NOTIFY_EMAIL set — email alert skipped')
      return
    }
    if (state.emailsToday >= DAILY_EMAIL_CAP) {
      console.warn(`[ops-alerts] daily alert email cap (${DAILY_EMAIL_CAP}) reached — Slack/logs only`)
      return
    }
    if (!(await platformGmailConnected())) {
      console.warn('[ops-alerts] platform Gmail not connected — email alert skipped')
      return
    }

    state.emailsToday++
    const subject = `🔴 Chat assistant DOWN — ${who}`
    const text = [
      `A visitor's chat message just failed and they were shown the "trouble connecting" fallback.`,
      '',
      `Client:  ${who} (${opts.clientId})`,
      `Error:   ${errMsg}`,
      `Time:    ${new Date().toISOString()}`,
      suppressed ? `Also:    ${suppressed} more failure${suppressed === 1 ? '' : 's'} in the last 30 minutes` : '',
      '',
      'Most likely causes, in order:',
      '  1. LLM provider out of credits (check the Anthropic console balance)',
      '  2. Bad/rotated API key or wrong LLM_PROVIDER (Render → agent-platform-api → Environment)',
      '  3. Provider outage (status.anthropic.com)',
      '',
      `You will get at most one of these emails per 30 minutes (max ${DAILY_EMAIL_CAP}/day); ongoing failures in between are counted, not emailed.`
    ].filter(Boolean).join('\n')

    await sendPlatformEmail(to, subject, text, {
      fromName: 'Agent Platform Monitor',
      extraHeaders: { 'X-Agent-Platform-Event': 'ops-alert' }
    })
  } catch (err) {
    console.error('[ops-alerts] alert failed', err instanceof Error ? err.message : err)
  }
}
