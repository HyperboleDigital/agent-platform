import { supabase } from './supabase'
import { getClientById } from './clients'
import { getStats } from './logs'
import { getMonthlyUsage } from './usage'
import { getLatestCrawl, getCrawlHistory } from './dataforseo'
import { getRuns } from './visibility'
import { sendGuardedEmail, type GuardedEmailResult } from './notify'

// Client-facing performance reports. buildReport aggregates ONLY data that
// already exists (no new tracking) into a persisted snapshot, so a report
// viewed months later shows the numbers as they were at generation time.
//
// Email delivery is deliberate-and-manual only (superadmin clicks "Send"),
// routed through lib/notify.ts's sendGuardedEmail — same test-mode + daily-cap
// guardrails as every other platform email, and reachable from NO scheduler.

export interface ReportData {
  clientName: string
  seo: {
    firstScore: number
    lastScore: number
    delta: number
    auditsInPeriod: number
  } | null
  visibility: {
    mentionRate: number // 0..1
    totalChecks: number
  } | null
  siteHealth: {
    score: number // 0..100 DataForSEO onpage_score
    topIssues: { title: string; severity: string; count: number }[]
  } | null
  chat: {
    conversationsThisMonth: number
    monthlyCap: number
    resolvedRate: number // 0..1
    estimatedHoursSaved: number
    questionsAnswered: number
    totalLeadsCaptured: number
  }
  requestsClosed: number
}

export interface Report {
  id: string
  clientId: string
  periodStart: string
  periodEnd: string
  data: ReportData
  createdAt: string
  sentAt: string | null
  sentTo: string | null
}

interface Row {
  id: string
  client_id: string
  period_start: string
  period_end: string
  data: ReportData
  created_at: string
  sent_at: string | null
  sent_to: string | null
}

function fromRow(r: Row): Report {
  return {
    id: r.id,
    clientId: r.client_id,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    data: r.data,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    sentTo: r.sent_to
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Aggregates a snapshot for [periodStart, periodEnd]. Defaults to the current
// calendar month when no range is given.
export async function buildReport(clientId: string, periodStart?: string, periodEnd?: string): Promise<Report> {
  const client = await getClientById(clientId)
  if (!client) throw new Error('Client not found')

  const now = new Date()
  const start = periodStart ?? isoDate(new Date(now.getFullYear(), now.getMonth(), 1))
  const end = periodEnd ?? isoDate(now)

  const [stats, usage, crawlHistory, visRuns, latestCrawl, closedRes] = await Promise.all([
    getStats(clientId),
    getMonthlyUsage(clientId),
    getCrawlHistory(clientId, 400),
    getRuns(clientId, 400),
    getLatestCrawl(clientId),
    supabase
      .from('change_requests')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('status', 'done')
      .gte('completed_at', `${start}T00:00:00Z`)
      .lte('completed_at', `${end}T23:59:59Z`)
  ])

  // SEO: on-page health-score trend — earliest vs latest finished crawl whose
  // created_at falls in the period. Sourced from crawls now that the crawl is
  // the single audit engine.
  const inPeriod = (ts: string) => ts.slice(0, 10) >= start && ts.slice(0, 10) <= end
  const periodCrawls = crawlHistory
    .filter(c => c.onpageScore != null && inPeriod(c.createdAt))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const seo = periodCrawls.length
    ? {
        firstScore: Math.round(periodCrawls[0].onpageScore!),
        lastScore: Math.round(periodCrawls[periodCrawls.length - 1].onpageScore!),
        delta: Math.round(periodCrawls[periodCrawls.length - 1].onpageScore!) - Math.round(periodCrawls[0].onpageScore!),
        auditsInPeriod: periodCrawls.length
      }
    : null

  // Visibility: mention rate across all runs in the period.
  const periodRuns = visRuns.filter(r => inPeriod(r.createdAt))
  const visibility = periodRuns.length
    ? { mentionRate: periodRuns.filter(r => r.mentioned).length / periodRuns.length, totalChecks: periodRuns.length }
    : null

  // Site health: current crawl-based health score + top issues (point-in-time,
  // from the latest finished crawl — not period-bounded).
  const siteHealth = latestCrawl && latestCrawl.status === 'finished' && latestCrawl.onpageScore != null
    ? {
        score: Math.round(latestCrawl.onpageScore),
        topIssues: (latestCrawl.issues ?? []).slice(0, 3).map(i => ({ title: i.title, severity: i.severity, count: i.count }))
      }
    : null

  const data: ReportData = {
    clientName: client.name,
    seo,
    visibility,
    siteHealth,
    chat: {
      conversationsThisMonth: usage.used,
      monthlyCap: usage.cap,
      resolvedRate: stats.resolvedRate,
      estimatedHoursSaved: stats.estimatedHoursSaved,
      questionsAnswered: stats.questionsAnswered,
      totalLeadsCaptured: stats.totalLeadsCaptured
    },
    requestsClosed: closedRes.count ?? 0
  }

  const { data: inserted, error } = await supabase
    .from('reports')
    .insert({ client_id: clientId, period_start: start, period_end: end, data })
    .select()
    .single()
  if (error) throw error
  return fromRow(inserted as Row)
}

export async function listReports(clientId: string): Promise<Report[]> {
  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
  if (error) { console.error('[reports] list error', error.message); return [] }
  return (data as Row[]).map(fromRow)
}

export async function getReport(clientId: string, reportId: string): Promise<Report | null> {
  const { data } = await supabase.from('reports').select('*').eq('client_id', clientId).eq('id', reportId).maybeSingle()
  return data ? fromRow(data as Row) : null
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

export function renderReportEmail(report: Report): { subject: string; body: string } {
  const d = report.data
  const lines: string[] = [
    `Performance report for ${d.clientName}`,
    `${report.periodStart} to ${report.periodEnd}`,
    ``,
    `CHATBOT`,
    `  Conversations this month: ${d.chat.conversationsThisMonth} of ${d.chat.monthlyCap}`,
    `  Resolved without a human: ${pct(d.chat.resolvedRate)}`,
    `  Estimated hours saved: ${d.chat.estimatedHoursSaved}`,
    `  Leads captured (all time): ${d.chat.totalLeadsCaptured}`,
    ``
  ]
  if (d.seo) {
    lines.push(
      `SEO`,
      `  Site SEO score: ${d.seo.lastScore}/100 (${d.seo.delta >= 0 ? '+' : ''}${d.seo.delta} over the period)`,
      ``
    )
  }
  if (d.siteHealth) {
    lines.push(`TECHNICAL HEALTH`, `  On-page technical score: ${d.siteHealth.score}/100 (crawl issues only — not keywords or rankings)`)
    for (const iss of d.siteHealth.topIssues) lines.push(`  • [${iss.severity}] ${iss.title}`)
    lines.push(``)
  }
  if (d.visibility) {
    lines.push(
      `AI SEARCH VISIBILITY`,
      `  Brand mentioned in ${pct(d.visibility.mentionRate)} of ${d.visibility.totalChecks} checks`,
      ``
    )
  }
  lines.push(`WEBSITE UPDATES`, `  Change requests completed: ${d.requestsClosed}`, ``, `— Hyperbole Digital`)

  return {
    subject: `Your ${d.clientName} performance report (${report.periodStart} – ${report.periodEnd})`,
    body: lines.join('\n')
  }
}

export interface SendReportResult extends GuardedEmailResult {}

// Manual, superadmin-triggered send with an EXPLICIT recipient in the request.
// Records the send on the report row for audit. Returns the guardrail result
// so the dashboard can show exactly what happened (incl. test-mode redirect).
export async function sendReport(clientId: string, reportId: string, to: string): Promise<SendReportResult> {
  const report = await getReport(clientId, reportId)
  if (!report) throw new Error('Report not found')
  if (!to.trim()) throw new Error('A recipient is required')

  const { subject, body } = renderReportEmail(report)
  const result = await sendGuardedEmail({ clientId, event: 'report.sent', to: to.trim(), subject, body })

  if (result.sent) {
    const { error } = await supabase
      .from('reports')
      .update({ sent_at: new Date().toISOString(), sent_to: result.recipient })
      .eq('id', reportId)
    if (error) console.error('[reports] failed to record send', error.message)
  }
  return result
}
