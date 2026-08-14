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
// This is the only scheduler in the platform permitted to send client email,
// and it exists against a standing rule that it must not. That rule was
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
  status: 'sent' | 'skipped' | 'failed'
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

// Runs one client's monthly report end to end. Safe to call directly (the
// superadmin "run now" path uses it too).
export async function deliverMonthlyReport(
  clientId: string,
  clientName: string,
  periodKey: string
): Promise<DeliveryOutcome> {
  const settings = await getNotificationSettings(clientId)
  if (!settings.email_enabled || !settings.email_to) {
    return { clientId, clientName, status: 'skipped', detail: 'No report recipient configured' }
  }

  if (!(await claimPeriod(clientId, periodKey))) {
    return { clientId, clientName, status: 'skipped', detail: `${periodKey} already delivered` }
  }

  try {
    // Refresh the baseline first so the report reflects the site as it is at
    // period close, not whenever someone last opened the dashboard. A failure
    // here is non-fatal — the report still has crawl and chat data.
    await runSiteBaseline(clientId).catch(err =>
      console.warn(`[report-scheduler] baseline failed for ${clientName}:`, err instanceof Error ? err.message : err))

    const { start, end } = periodBounds(periodKey)
    const report = await buildReport(clientId, start, end)
    const { subject, body } = renderReportEmail(report)

    const result = await sendGuardedEmail({
      clientId, event: 'report.ready', to: settings.email_to, subject, body,
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

// The scheduled entry point. Sends only for the month that just ended, and
// only to clients whose tier promises the report.
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
