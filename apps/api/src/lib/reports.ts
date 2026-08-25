import { supabase } from './supabase'
import { getClientById } from './clients'
import { getStats } from './logs'
import { getMonthlyUsage } from './usage'
import { getLatestCrawl, getCrawlHistory } from './dataforseo'
import { getRuns } from './visibility'
import { sendGuardedEmail, type GuardedEmailResult } from './notify'
import { latestBaseline, previousBaseline } from './site-baseline'
import { isEntitled } from './entitlements'

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
    // Per-provider breakdown (handoff #3 §3) — absent on reports built before
    // 2026-08-25.
    byProvider?: Record<string, { mentionRate: number; runs: number }>
  } | null
  // Keyword movement over the period (first vs last rank check) — the
  // report's counterpart of the "This month" panel's movers list. Optional:
  // reports stored before 2026-08-25 don't carry it.
  keywords?: {
    tracked: number
    movedUp: { keyword: string; from: number | null; to: number | null }[]
    movedDown: { keyword: string; from: number | null; to: number | null }[]
  } | null
  // Content published in the period (Growth tier). Optional as above.
  content?: { published: { title: string; keyword: string }[] } | null
  // Open unanswered chatbot questions feeding next month's content plan.
  unansweredCount?: number
  // seo_fix requests VERIFIED against a crawl in the period (never bare
  // 'done' counts — see migrate_2026-08-25b_seo-fix-tracking.sql).
  issuesFixed?: number
  siteHealth: {
    score: number // 0..100 DataForSEO onpage_score
    topIssues: { title: string; severity: string; count: number }[]
  } | null
  // The Care-tier technical baseline (speed, mobile, titles/descriptions,
  // indexing). Null when no baseline has ever been run for the client — the
  // report still renders without it rather than failing.
  baseline: {
    mobileScore: number | null
    previousMobileScore: number | null
    checks: { key: string; label: string; status: string; detail: string; findings: string[] }[]
  } | null
  // Null when the client isn't entitled to the chat assistant. A Care client
  // has no chatbot, so including this section rendered a wall of zeros
  // ("0 conversations, 0% resolved, 0 hours saved") that reads as the service
  // performing terribly rather than as a service they don't have.
  chat: {
    conversationsThisMonth: number
    monthlyCap: number
    resolvedRate: number // 0..1
    estimatedHoursSaved: number
    questionsAnswered: number
    totalLeadsCaptured: number
  } | null
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

  // Visibility: mention rate across all runs in the period, with the
  // per-provider breakdown the SEO+GEO tier promises.
  const periodRuns = visRuns.filter(r => inPeriod(r.createdAt))
  const byProvider: Record<string, { mentionRate: number; runs: number }> = {}
  for (const r of periodRuns) {
    const p = byProvider[r.provider] ?? { mentionRate: 0, runs: 0 }
    p.runs++
    if (r.mentioned) p.mentionRate++
    byProvider[r.provider] = p
  }
  for (const p of Object.values(byProvider)) p.mentionRate = p.runs ? p.mentionRate / p.runs : 0
  const visibility = periodRuns.length
    ? { mentionRate: periodRuns.filter(r => r.mentioned).length / periodRuns.length, totalChecks: periodRuns.length, byProvider }
    : null

  // Keyword movers: first vs last rank check in the period per tracked
  // keyword. Each read tolerates its own failure (e.g. a table whose
  // migration hasn't run yet) so the report still builds without the section.
  const [rankRes, kwRes, postRes, unansweredRes, verifiedRes] = await Promise.all([
    supabase.from('seo_keyword_ranks').select('keyword_id, keyword, rank_absolute, checked_at')
      .eq('client_id', clientId).gte('checked_at', `${start}T00:00:00Z`).lte('checked_at', `${end}T23:59:59Z`)
      .order('checked_at', { ascending: true }),
    supabase.from('seo_target_keywords').select('id').eq('client_id', clientId),
    supabase.from('blog_posts').select('title, target_keyword, status, published_at').eq('client_id', clientId),
    supabase.from('chat_unanswered_questions').select('id', { count: 'exact', head: true })
      .eq('client_id', clientId).eq('status', 'open'),
    supabase.from('change_requests').select('id')
      .eq('client_id', clientId).eq('source', 'seo_fix')
      .gte('verified_at', `${start}T00:00:00Z`).lte('verified_at', `${end}T23:59:59Z`),
  ])
  const rankRows = rankRes.error ? [] : rankRes.data ?? []
  const kwRows = kwRes.error ? [] : kwRes.data ?? []
  const postRows = postRes.error ? [] : postRes.data ?? []
  const unansweredCount = unansweredRes.error ? undefined : unansweredRes.count ?? 0
  const verifiedRows = verifiedRes.error ? [] : verifiedRes.data ?? []
  const trackedIds = new Set((kwRows as any[]).map(k => k.id))
  const byKw = new Map<string, { keyword: string; first: number | null; last: number | null }>()
  for (const r of rankRows as any[]) {
    if (!trackedIds.has(r.keyword_id)) continue
    const e = byKw.get(r.keyword_id)
    if (!e) byKw.set(r.keyword_id, { keyword: r.keyword, first: r.rank_absolute, last: r.rank_absolute })
    else e.last = r.rank_absolute
  }
  const movedUp: { keyword: string; from: number | null; to: number | null }[] = []
  const movedDown: { keyword: string; from: number | null; to: number | null }[] = []
  for (const { keyword, first, last } of byKw.values()) {
    if ((last ?? 101) < (first ?? 101)) movedUp.push({ keyword, from: first, to: last })
    else if ((last ?? 101) > (first ?? 101)) movedDown.push({ keyword, from: first, to: last })
  }
  const keywords = trackedIds.size > 0 ? { tracked: trackedIds.size, movedUp, movedDown } : null
  const published = (postRows as any[])
    .filter(p => p.status === 'published' && p.published_at && p.published_at.slice(0, 10) >= start && p.published_at.slice(0, 10) <= end)
  const content = published.length ? { published: published.map(p => ({ title: p.title ?? '(untitled)', keyword: p.target_keyword })) } : null

  // Site health: current crawl-based health score + top issues (point-in-time,
  // from the latest finished crawl — not period-bounded).
  const siteHealth = latestCrawl && latestCrawl.status === 'finished' && latestCrawl.onpageScore != null
    ? {
        score: Math.round(latestCrawl.onpageScore),
        topIssues: (latestCrawl.issues ?? []).slice(0, 3).map(i => ({ title: i.title, severity: i.severity, count: i.count }))
      }
    : null

  // Technical baseline, with the prior snapshot alongside it so the email can
  // report movement ("was 41, now 65") rather than a bare number the client
  // has no way to judge.
  const currentBaseline = await latestBaseline(clientId).catch(() => null)
  const priorBaseline = currentBaseline
    ? await previousBaseline(clientId, currentBaseline.createdAt)
    : null
  const baseline = currentBaseline
    ? {
        mobileScore: currentBaseline.mobileScore,
        previousMobileScore: priorBaseline?.mobileScore ?? null,
        checks: currentBaseline.checks.map(c => ({
          key: c.key, label: c.label, status: c.status, detail: c.detail, findings: c.findings,
        })),
      }
    : null

  // Only report on the chatbot if they actually have one — see ReportData.chat.
  const chatEntitled = await isEntitled(clientId, 'chat').catch(() => false)

  const data: ReportData = {
    clientName: client.name,
    seo,
    visibility,
    siteHealth,
    baseline,
    keywords,
    content,
    unansweredCount,
    issuesFixed: (verifiedRows as any[]).length,
    chat: chatEntitled
      ? {
          conversationsThisMonth: usage.used,
          monthlyCap: usage.cap,
          resolvedRate: stats.resolvedRate,
          estimatedHoursSaved: stats.estimatedHoursSaved,
          questionsAnswered: stats.questionsAnswered,
          totalLeadsCaptured: stats.totalLeadsCaptured
        }
      : null,
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

// Scoped by client_id as well as id so a report can never be deleted through
// the wrong client's route, even with a valid report id from elsewhere.
//
// report_deliveries.report_id is ON DELETE SET NULL, so removing a report does
// NOT free up its month for the monthly scheduler to send again — the delivery
// claim survives deliberately. Deleting a bad report is a cleanup action, not a
// way to trigger a re-send.
export async function deleteReport(clientId: string, reportId: string): Promise<void> {
  const { error } = await supabase
    .from('reports')
    .delete()
    .eq('client_id', clientId)
    .eq('id', reportId)
  if (error) throw new Error(`Failed to delete report: ${error.message}`)
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

// Plain ASCII rather than emoji: this is a text/plain email body and the
// recipient's client may render emoji inconsistently or not at all.
const STATUS_MARK: Record<string, string> = {
  good: '[OK]', warn: '[!]', poor: '[X]', unknown: '[-]',
}

export function renderReportEmail(report: Report): { subject: string; body: string } {
  const d = report.data
  const lines: string[] = [
    `Performance report for ${d.clientName}`,
    `${report.periodStart} to ${report.periodEnd}`,
    ``
  ]
  // Omitted entirely for clients without the chat assistant — see ReportData.chat.
  if (d.chat) {
    lines.push(
      `CHATBOT`,
      `  Conversations this month: ${d.chat.conversationsThisMonth} of ${d.chat.monthlyCap}`,
      `  Resolved without a human: ${pct(d.chat.resolvedRate)}`,
      `  Estimated hours saved: ${d.chat.estimatedHoursSaved}`,
      `  Leads captured (all time): ${d.chat.totalLeadsCaptured}`,
      ``
    )
  }
  if (d.seo) {
    lines.push(
      `SEO`,
      `  Site SEO score: ${d.seo.lastScore}/100 (${d.seo.delta >= 0 ? '+' : ''}${d.seo.delta} over the period)`,
      ``
    )
  }
  // The Care client's headline section: the four baseline checks in plain
  // language. Placed before the crawl score because "your site takes 14
  // seconds to load on a phone" is actionable, where "62/100" is not.
  if (d.baseline) {
    lines.push(`SITE HEALTH CHECK`)
    if (d.baseline.mobileScore != null) {
      const prev = d.baseline.previousMobileScore
      const move = prev != null ? ` (was ${prev} last month)` : ''
      lines.push(`  Mobile speed score: ${d.baseline.mobileScore}/100${move}`)
    }
    for (const c of d.baseline.checks) {
      lines.push(`  ${STATUS_MARK[c.status] ?? '•'} ${c.label}: ${c.detail}`)
      for (const f of c.findings.slice(0, 2)) lines.push(`      - ${f}`)
    }
    lines.push(``)
  }
  if (d.siteHealth) {
    lines.push(`TECHNICAL HEALTH`, `  On-page technical score: ${d.siteHealth.score}/100 (crawl issues only — not keywords or rankings)`)
    for (const iss of d.siteHealth.topIssues) lines.push(`  • [${iss.severity}] ${iss.title}`)
    lines.push(``)
  }
  if (d.keywords && (d.keywords.movedUp.length || d.keywords.movedDown.length)) {
    lines.push(`KEYWORD MOVEMENT (${d.keywords.tracked} tracked)`)
    const fmtRank = (r: number | null) => (r == null ? '100+' : `#${r}`)
    for (const k of d.keywords.movedUp.slice(0, 5)) lines.push(`  ^ "${k.keyword}": ${fmtRank(k.from)} -> ${fmtRank(k.to)}`)
    for (const k of d.keywords.movedDown.slice(0, 3)) lines.push(`  v "${k.keyword}": ${fmtRank(k.from)} -> ${fmtRank(k.to)}`)
    lines.push(``)
  }
  if (d.visibility) {
    const providerNames: Record<string, string> = { openai: 'ChatGPT', anthropic: 'Claude', perplexity: 'Perplexity', google_aio: 'Google AI Overviews' }
    lines.push(
      `AI SEARCH VISIBILITY`,
      `  Brand mentioned in ${pct(d.visibility.mentionRate)} of ${d.visibility.totalChecks} checks`,
    )
    for (const [prov, v] of Object.entries(d.visibility.byProvider ?? {})) {
      lines.push(`    ${providerNames[prov] ?? prov}: ${pct(v.mentionRate)} of ${v.runs}`)
    }
    lines.push(``)
  }
  if (d.content?.published.length) {
    lines.push(`CONTENT PUBLISHED`)
    for (const p of d.content.published) lines.push(`  • ${p.title} (targeting "${p.keyword}")`)
    lines.push(``)
  }
  lines.push(`WEBSITE UPDATES`, `  Change requests completed: ${d.requestsClosed}`)
  if (d.issuesFixed != null && d.issuesFixed > 0) lines.push(`  SEO fixes confirmed by re-crawl: ${d.issuesFixed}`)
  if (d.unansweredCount != null && d.unansweredCount > 0) {
    lines.push(``, `CUSTOMER QUESTIONS`, `  ${d.unansweredCount} real customer question(s) captured by your chat assistant are feeding next month's content plan.`)
  }
  lines.push(``, `— Hyperbole Digital`)

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
