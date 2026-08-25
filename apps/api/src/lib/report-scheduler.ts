import { supabase } from './supabase'
import { getAllClients } from './clients'
import { tierForKey } from './tiers'
import { runSiteBaseline } from './site-baseline'
import { buildReport, renderReportEmail } from './reports'
import { sendGuardedEmail, getNotificationSettings } from './notify'

// Automated monthly health report — the second Care bullet in lib/tiers.ts.
//
// READ THIS BEFORE CHANGING ANYTHING HERE.
//
// SINCE 2026-08-25 (handoff #3 §6) the scheduled path is DRAFT-ONLY: it
// generates the report, claims the period, and nudges the superadmin on
// Slack; the email itself leaves only on a superadmin click (sendReport, or
// the run-now route which passes sendEmail: true). The machinery below is
// kept intact because the deliberate-send path still uses it, and because
// every guarantee still matters even for drafts (one draft per period).
//
// Historical context: this was the only scheduler in the platform permitted
// to send client email, against a standing rule that it must not. That rule was
// written after 582 emails were auto-sent to a real inbox from an unbounded
// loop (see lib/notify.ts). It is allowed here only because every one of the
// following holds, and it stops being safe the moment any of them is removed:
//
//   1. CLAIM BEFORE SEND. A period is claimed by inserting a row into
//      report_deliveries, which carries a UNIQUE (client_id, period_key)
//      index. The send only happens if that insert succeeded. Two API
//      instances, a double-fired timer, a restart mid-send, or a retry loop
//      all lose the race in the database rather than in application logic —
//      so a second email for the same client and month cannot be produced.
//      The claim is never rolled back on failure, deliberately: a failed send
//      stays claimed and visible rather than being retried forever.
//   2. ONE PERIOD PER RUN. It only ever sends for the month that just ended.
//      There is no backfill and no catch-up loop, so a deploy after months of
//      downtime sends at most one email per client, not one per missed month.
//   3. STILL GUARDED. Delivery goes through sendGuardedEmail, keeping the
//      platform-wide daily cap and REPORT_EMAIL_TEST_MODE. Test mode defaults
//      ON, so a fresh deploy sends to the test inbox until deliberately
//      switched off.
//   4. OPT-IN. A client is only eligible with notification settings that have
//      email enabled and a recipient set. No recipient means no send.
//
// If you need to re-send a period, delete that report_deliveries row by hand.
// That is intentionally a deliberate human act.

// 'YYYY-MM' for the month that just ended, relative to `now`.
export function previousPeriodKey(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  d.setUTCMonth(d.getUTCMonth() - 1)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function periodBounds(periodKey: string): { start: string; end: string } {
  const [y, m] = periodKey.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1))
  const end = new Date(Date.UTC(y, m, 0)) // day 0 of next month = last day of this one
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

// Which tiers actually promise a monthly report. Read from the tier catalog
// rather than hardcoded, so adding the bullet to another tier enrolls it
// without touching this file.
function tierPromisesReport(tierKey: string | null): boolean {
  const tier = tierForKey(tierKey)
  if (!tier) return false
  return tier.features.some(f => /monthly health report/i.test(f.text))
}

export interface DeliveryOutcome {
  clientId: string
  clientName: string
  status: 'sent' | 'drafted' | 'skipped' | 'failed'
  detail: string
}

// Attempts to claim the period for this client. Returns false when the row
// already exists — that is the "already handled" signal, not an error.
async function claimPeriod(clientId: string, periodKey: string): Promise<boolean> {
  const { error } = await supabase
    .from('report_deliveries')
    .insert({ client_id: clientId, period_key: periodKey, status: 'pending' })
  if (!error) return true
  // 23505 = unique_violation. Anything else is a real failure and must not be
  // mistaken for "already sent", or a broken database would silently suppress
  // every report instead of surfacing.
  if (error.code === '23505') return false
  throw new Error(`Failed to claim report period: ${error.message}`)
}

async function finishClaim(
  clientId: string, periodKey: string,
  patch: { status: string; recipient?: string | null; detail?: string; reportId?: string | null }
): Promise<void> {
  const { error } = await supabase
    .from('report_deliveries')
    .update({
      status: patch.status,
      recipient: patch.recipient ?? null,
      detail: patch.detail ?? null,
      report_id: patch.reportId ?? null,
    })
    .eq('client_id', clientId)
    .eq('period_key', periodKey)
  if (error) console.error('[report-scheduler] failed to finalize claim:', error.message)
}

// Slack nudge to the superadmin when a scheduled report draft is ready
// (handoff #3 §6). Slack is explicitly allowed — it is not the email path.
// Best-effort; a Slack failure never fails the draft.
async function nudgeSuperadmin(clientName: string, periodKey: string): Promise<void> {
  const webhook = process.env.SUPERADMIN_SLACK_WEBHOOK
  if (!webhook) return
  try {
    const dashboardUrl = process.env.DASHBOARD_URL ?? ''
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `Monthly report drafted — ${clientName} (${periodKey}). Review it in the dashboard and click Send.${dashboardUrl ? ` ${dashboardUrl}` : ''}`,
      }),
    })
    if (!res.ok) throw new Error(`Slack ${res.status}`)
  } catch (err) {
    console.warn('[report-scheduler] Slack nudge failed:', err instanceof Error ? err.message : err)
  }
}

// Runs one client's monthly report. Since 2026-08-25 (handoff #3 §6) the
// SCHEDULED path only GENERATES the report and nudges the superadmin on
// Slack — the email leaves via the dashboard's Send button (sendReport, still
// guarded). Passing sendEmail: true restores the full deliver-and-send, used
// ONLY by the superadmin "run monthly report now" route — a deliberate human
// click, which is exactly the boundary the 582-email guardrail draws.
export async function deliverMonthlyReport(
  clientId: string,
  clientName: string,
  periodKey: string,
  opts: { sendEmail?: boolean } = {}
): Promise<DeliveryOutcome> {
  const settings = await getNotificationSettings(clientId)
  if (opts.sendEmail && (!settings.email_enabled || !settings.email_to)) {
    return { clientId, clientName, status: 'skipped', detail: 'No report recipient configured' }
  }

  if (!(await claimPeriod(clientId, periodKey))) {
    return { clientId, clientName, status: 'skipped', detail: `${periodKey} already handled` }
  }

  try {
    // Refresh the baseline first so the report reflects the site as it is at
    // period close, not whenever someone last opened the dashboard. A failure
    // here is non-fatal — the report still has crawl and chat data.
    await runSiteBaseline(clientId).catch(err =>
      console.warn(`[report-scheduler] baseline failed for ${clientName}:`, err instanceof Error ? err.message : err))

    const { start, end } = periodBounds(periodKey)
    const report = await buildReport(clientId, start, end)

    if (!opts.sendEmail) {
      // Draft-only: claim the period as drafted and hand off to a human.
      await finishClaim(clientId, periodKey, { status: 'drafted', reportId: report.id })
      await nudgeSuperadmin(clientName, periodKey)
      return { clientId, clientName, status: 'drafted', detail: 'Report generated — awaiting superadmin review + send' }
    }

    const { subject, body } = renderReportEmail(report)

    const result = await sendGuardedEmail({
      // settings.email_to is guaranteed by the sendEmail guard above.
      clientId, event: 'report.ready', to: settings.email_to!, subject, body,
    })

    if (!result.sent) {
      await finishClaim(clientId, periodKey, { status: 'failed', detail: result.reason ?? 'not sent', reportId: report.id })
      return { clientId, clientName, status: 'failed', detail: result.reason ?? 'not sent' }
    }

    await supabase.from('reports')
      .update({ sent_at: new Date().toISOString(), sent_to: result.recipient })
      .eq('id', report.id)
    await finishClaim(clientId, periodKey, { status: 'sent', recipient: result.recipient, reportId: report.id })
    return {
      clientId, clientName, status: 'sent',
      detail: `${result.recipient}${result.testMode ? ' (test mode)' : ''}`,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Report generation failed'
    await finishClaim(clientId, periodKey, { status: 'failed', detail: message })
    return { clientId, clientName, status: 'failed', detail: message }
  }
}

// The scheduled entry point. DRAFTS only (see above) — one draft per client
// for the month that just ended, only for tiers promising the report.
export async function runMonthlyReports(now = new Date()): Promise<DeliveryOutcome[]> {
  const periodKey = previousPeriodKey(now)
  const clients = await getAllClients()
  const eligible = clients.filter(c => c.active && tierPromisesReport(c.tierKey ?? null))

  const outcomes: DeliveryOutcome[] = []
  // Sequential on purpose: each one runs a Lighthouse pass and sends mail, and
  // the daily cap is a shared budget. Parallelising would race the cap check.
  for (const client of eligible) {
    outcomes.push(await deliverMonthlyReport(client.id, client.name, periodKey))
  }
  if (outcomes.length) {
    const sent = outcomes.filter(o => o.status === 'sent').length
    console.log(`[report-scheduler] ${periodKey}: ${sent} sent, ${outcomes.length - sent} skipped/failed`)
  }
  return outcomes
}

// Only act in a narrow window at the start of a month. The unique index is the
// real guarantee against duplicates; this just avoids doing the work (and the
// paid Lighthouse/crawl calls) on every tick for the other 30 days.
export function isReportWindow(now = new Date()): boolean {
  return now.getUTCDate() <= 3
}
