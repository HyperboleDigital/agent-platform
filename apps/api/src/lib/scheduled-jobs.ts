import { supabase } from './supabase'
import { getAllClients, getClientById } from './clients'
import { getEntitlements } from './entitlements'
import { deliverMonthlyReport, previousPeriodKey } from './report-scheduler'
import { startCrawl, crawlConfigured } from './dataforseo'
import { checkKeywordRanks, listTargetKeywords } from './seo-keywords'
import { runVisibilityChecks, listQueries } from './visibility'
import { snapshotGsc, gscConfigured } from './gsc'
import { snapshotAds, googleAdsConfigured } from './google-ads'
import { listGbpActivity } from './local-presence'
import { getLatestSiteHealth, recordSiteHealthCheck } from './site-health'

// Scheduled jobs backbone (handoff #2 §1). One dispatcher, handlers registered
// by job_type — NOT a cron per job type. Rows in scheduled_jobs are
// auto-provisioned from tier + add-on entitlements by reconcileClientJobs;
// nothing creates them by hand.
//
// Every handler must be idempotent: the dispatcher CAS-claims a row before
// running (so two API instances can't both run the same due job), but a claim
// followed by a crash means the job simply runs again at its next cadence —
// handlers must tolerate that. The ones below all are: startCrawl reuses a
// running crawl, deliverMonthlyReport is claim-row-guarded in the database,
// uptime/GSC/ads snapshots are append-only observations, and rank/visibility
// checks just re-measure.

export type JobStatus = 'ok' | 'partial' | 'failed'

export interface JobResult {
  status: JobStatus
  detail?: string
}

type JobHandler = (clientId: string) => Promise<JobResult>

interface JobDef {
  label: string
  description: string
  // No handler = promised but not yet built. The dispatcher marks these failed
  // with an explicit message instead of skipping them: the Jobs view has to be
  // honest, and "we schedule it but nothing delivers it" is exactly the state
  // it exists to expose (see the verification requirement in handoff #2 §4).
  handler?: JobHandler
}

// ── Handlers ─────────────────────────────────────────────────────────────────

async function runUptimeCheck(clientId: string): Promise<JobResult> {
  const client = await getClientById(clientId)
  if (!client?.domain) return { status: 'partial', detail: 'No domain configured' }
  const result = await recordSiteHealthCheck(clientId, client.domain)
  return result.up
    ? { status: 'ok', detail: `Up, SSL ${result.ssl?.daysRemaining ?? '?'}d remaining` }
    : { status: 'partial', detail: 'Site is DOWN — recorded; alerting handled by site monitor' }
}

async function runCrawl(clientId: string): Promise<JobResult> {
  if (!crawlConfigured()) return { status: 'failed', detail: 'DataForSEO not configured' }
  const crawl = await startCrawl(clientId) // reuses an already-running crawl
  return { status: 'ok', detail: `Crawl ${crawl.status} (${crawl.url})` }
}

async function runRankCheck(clientId: string): Promise<JobResult> {
  const keywords = await listTargetKeywords(clientId)
  if (keywords.length === 0) {
    // Not a silent skip: no tracked keywords means the Care report's block 2
    // can't render and the upsell engine is dead. Onboarding is supposed to
    // configure keywords for EVERY tier (handoff #2 §2.2) — surface the gap.
    return { status: 'partial', detail: 'No tracked keywords configured — keyword setup is a required onboarding step' }
  }
  const checked = await checkKeywordRanks(clientId)
  const ranked = checked.filter(k => k.latestRank !== null).length
  return { status: 'ok', detail: `${checked.length} keywords checked, ${ranked} ranking` }
}

async function runVisibilityPoll(clientId: string): Promise<JobResult> {
  const queries = await listQueries(clientId)
  if (queries.length === 0) {
    return { status: 'partial', detail: 'No visibility queries configured — add tracked questions in the SEO section' }
  }
  const runs = await runVisibilityChecks(clientId)
  const mentioned = runs.filter(r => r.mentioned).length
  return { status: 'ok', detail: `${runs.length} checks, mentioned in ${mentioned}` }
}

async function runGscSync(clientId: string): Promise<JobResult> {
  if (!gscConfigured()) return { status: 'failed', detail: 'GSC not configured (platform level)' }
  await snapshotGsc(clientId)
  return { status: 'ok' }
}

async function runAdsSync(clientId: string): Promise<JobResult> {
  if (!googleAdsConfigured()) return { status: 'failed', detail: 'Google Ads not configured (platform level)' }
  await snapshotAds(clientId)
  return { status: 'ok' }
}

async function runHealthReport(clientId: string): Promise<JobResult> {
  const client = await getClientById(clientId)
  if (!client) return { status: 'failed', detail: 'Client not found' }
  const outcome = await deliverMonthlyReport(clientId, client.name, previousPeriodKey())
  // 'skipped' covers both "already delivered this period" (fine) and "no
  // recipient configured" (a gap worth seeing) — the detail says which.
  const map: Record<string, JobStatus> = { sent: 'ok', skipped: 'partial', failed: 'failed' }
  return { status: map[outcome.status] ?? 'failed', detail: outcome.detail }
}

// GBP posting is (currently) a human task logged via the Local Presence
// section. The job doesn't post — it VERIFIES the obligation was met, which is
// what makes "GBP posts" on the info sheet traceable to something that ran.
async function runGbpPostCheck(clientId: string): Promise<JobResult> {
  const activity = await listGbpActivity(clientId, 8)
  const posted = activity.filter(a => a.kind === 'post')
  return posted.length > 0
    ? { status: 'ok', detail: `${posted.length} GBP post(s) logged this week` }
    : { status: 'partial', detail: 'No GBP post logged in the last 7 days — the add-on promises weekly posts' }
}

// ── Registry ─────────────────────────────────────────────────────────────────

export const JOB_DEFS: Record<string, JobDef> = {
  uptime_check: { label: 'Uptime check', description: 'Site up/down + SSL expiry', handler: runUptimeCheck },
  crawl: { label: 'Site crawl', description: 'DataForSEO technical crawl', handler: runCrawl },
  rank_check: { label: 'Rank check', description: 'Tracked keyword positions', handler: runRankCheck },
  visibility_poll: { label: 'AI visibility poll', description: 'Citation checks across AI providers', handler: runVisibilityPoll },
  gsc_sync: { label: 'GSC sync', description: 'Search Console impressions/clicks snapshot', handler: runGscSync },
  health_report: { label: 'Monthly health report', description: 'Renders + delivers the monthly report', handler: runHealthReport },
  gbp_post: { label: 'GBP post check', description: 'Verifies a Google Business Profile post was logged this week', handler: runGbpPostCheck },
  ads_sync: { label: 'Ads sync', description: 'Google Ads performance snapshot', handler: runAdsSync },
  // Promised by tier/add-on but not yet built — dispatcher fails these loudly.
  local_pack_check: { label: 'Local pack check', description: 'Map-pack position tracking (needs SERP API work, handoff #2 §3.4)' },
  chat_metrics_rollup: { label: 'Chat metrics rollup', description: 'Monthly chat metrics for the Growth report (handoff #2 §2.4)' },
  unanswered_digest: { label: 'Unanswered questions digest', description: 'Top unanswered themes for reports (handoff #2 §2.4)' },
}

// ── Desired job set ──────────────────────────────────────────────────────────

interface DesiredJob {
  jobType: string
  cadence: 'daily' | 'weekly' | 'monthly'
  dayOfMonth?: number
}

// Monthly days are staggered so data-collection jobs land BEFORE the report
// that reads them: crawl/ranks/visibility early, report on the 5th (also
// inside report-scheduler's isReportWindow, days 1–3 — the report job is
// belt-and-braces with that legacy interval until it's retired).
const MONTHLY_DAY: Record<string, number> = {
  crawl: 1, rank_check: 2, visibility_poll: 3, local_pack_check: 3,
  chat_metrics_rollup: 4, unanswered_digest: 4, health_report: 5,
}

// The job-set-by-tier table from handoff #2 §1, derived from entitlements
// rather than tier keys so comped services provision too. Deliberate
// deviation from the table: the two chat jobs key on the `chat` entitlement
// rather than the Growth tier, because a chatbot-at-Care client (comp grant at
// downgrade) still needs chat metrics for their report's chatbot block.
export async function desiredJobsFor(clientId: string): Promise<DesiredJob[]> {
  const client = await getClientById(clientId)
  if (!client?.active) return [] // inactive clients get nothing scheduled
  const ent = await getEntitlements(clientId)
  if (!ent.planKey) return [] // no tier -> no promised deliverables

  const jobs: DesiredJob[] = [
    { jobType: 'crawl', cadence: 'monthly' },
    { jobType: 'health_report', cadence: 'monthly' },
    { jobType: 'uptime_check', cadence: 'daily' },
    // Care gets a monthly read-only rank check (report block 2); SEO+ upgrades
    // it to weekly below.
    { jobType: 'rank_check', cadence: 'monthly' },
  ]

  const seoActive = ent.services.seo?.entitled ?? false
  if (seoActive) {
    jobs.find(j => j.jobType === 'rank_check')!.cadence = 'weekly'
    jobs.push(
      { jobType: 'visibility_poll', cadence: 'monthly' },
      { jobType: 'gsc_sync', cadence: 'weekly' },
    )
  } else {
    // Care still polls visibility (the "0 of N citations" line in report
    // block 2) — minimal query set, same monthly cadence.
    jobs.push({ jobType: 'visibility_poll', cadence: 'monthly' })
  }

  if (ent.services.chat?.entitled) {
    jobs.push(
      { jobType: 'chat_metrics_rollup', cadence: 'monthly' },
      { jobType: 'unanswered_digest', cadence: 'monthly' },
    )
  }
  if (ent.services.local?.entitled) {
    jobs.push(
      { jobType: 'local_pack_check', cadence: 'monthly' },
      { jobType: 'gbp_post', cadence: 'weekly' },
    )
  }
  if (ent.services.ads?.entitled) {
    jobs.push({ jobType: 'ads_sync', cadence: 'weekly' })
  }

  for (const j of jobs) if (j.cadence === 'monthly') j.dayOfMonth = MONTHLY_DAY[j.jobType] ?? 1
  return jobs
}

// ── Scheduling math ──────────────────────────────────────────────────────────

const RUN_HOUR_UTC = 6 // quiet hours in US timezones, after most nightly data settles

export function computeNextRun(
  cadence: 'daily' | 'weekly' | 'monthly',
  dayOfMonth: number | null,
  from = new Date()
): Date {
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), RUN_HOUR_UTC))
  if (cadence === 'daily') {
    if (next <= from) next.setUTCDate(next.getUTCDate() + 1)
    return next
  }
  if (cadence === 'weekly') {
    next.setUTCDate(next.getUTCDate() + 7)
    return next
  }
  // monthly: next occurrence of day_of_month. Clamp to 28 so February can't
  // silently skip a month.
  const day = Math.min(dayOfMonth ?? 1, 28)
  const candidate = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), day, RUN_HOUR_UTC))
  if (candidate <= from) candidate.setUTCMonth(candidate.getUTCMonth() + 1)
  return candidate
}

// ── Reconciliation (auto-provisioning) ───────────────────────────────────────

// Brings a client's scheduled_jobs rows in line with what their tier + add-ons
// promise. Called on every tier transition and add-on change, plus an hourly
// sweep for drift. Idempotent via the (client_id, job_type) unique index.
//
// Rows for no-longer-entitled jobs are DISABLED, not deleted — last_run
// history stays visible, and re-entitling re-enables the same row.
export async function reconcileClientJobs(clientId: string): Promise<{ added: number; enabled: number; disabled: number }> {
  const desired = await desiredJobsFor(clientId)
  const { data: existing, error } = await supabase
    .from('scheduled_jobs')
    .select('id, job_type, cadence, day_of_month, enabled')
    .eq('client_id', clientId)
  if (error) throw new Error(`reconcile: ${error.message}`)

  const byType = new Map((existing ?? []).map(r => [r.job_type as string, r]))
  let added = 0, enabled = 0, disabled = 0

  for (const want of desired) {
    const have = byType.get(want.jobType)
    if (!have) {
      // First provision runs soon (data starts flowing for a new client
      // immediately) — EXCEPT the report, which must wait for its slot so a
      // mid-month tier change can't fire a mid-month report.
      const nextRun = want.jobType === 'health_report'
        ? computeNextRun(want.cadence, want.dayOfMonth ?? null)
        : new Date()
      const { error: insErr } = await supabase.from('scheduled_jobs').insert({
        client_id: clientId,
        job_type: want.jobType,
        cadence: want.cadence,
        day_of_month: want.dayOfMonth ?? null,
        next_run_at: nextRun.toISOString(),
      })
      if (insErr && insErr.code !== '23505') throw new Error(`reconcile insert: ${insErr.message}`)
      if (!insErr) added++
      continue
    }
    if (!have.enabled || have.cadence !== want.cadence) {
      const { error: updErr } = await supabase.from('scheduled_jobs').update({
        enabled: true,
        cadence: want.cadence,
        day_of_month: want.dayOfMonth ?? null,
        // Cadence changed (e.g. rank_check monthly -> weekly on upgrade):
        // reschedule from now rather than keeping a slot computed under the
        // old cadence.
        next_run_at: computeNextRun(want.cadence, want.dayOfMonth ?? null).toISOString(),
      }).eq('id', have.id)
      if (updErr) throw new Error(`reconcile update: ${updErr.message}`)
      enabled++
    }
  }

  const wantedTypes = new Set(desired.map(d => d.jobType))
  for (const row of existing ?? []) {
    if (!wantedTypes.has(row.job_type as string) && row.enabled) {
      const { error: disErr } = await supabase.from('scheduled_jobs').update({ enabled: false }).eq('id', row.id)
      if (disErr) throw new Error(`reconcile disable: ${disErr.message}`)
      disabled++
    }
  }
  return { added, enabled, disabled }
}

export async function reconcileAllClients(): Promise<void> {
  const clients = await getAllClients()
  for (const c of clients) {
    try {
      await reconcileClientJobs(c.id)
    } catch (err) {
      console.error(`[jobs] reconcile failed for ${c.name}:`, err instanceof Error ? err.message : err)
    }
  }
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

async function executeJob(row: { id: string; client_id: string; job_type: string }): Promise<void> {
  const def = JOB_DEFS[row.job_type]
  let result: JobResult
  try {
    result = def?.handler
      ? await def.handler(row.client_id)
      : { status: 'failed', detail: 'No handler implemented yet — this deliverable is promised but nothing delivers it' }
  } catch (err) {
    result = { status: 'failed', detail: err instanceof Error ? err.message : 'Unknown error' }
  }
  const { error } = await supabase.from('scheduled_jobs').update({
    last_status: result.status,
    last_error: result.status === 'ok' ? null : result.detail ?? null,
  }).eq('id', row.id)
  if (error) console.error(`[jobs] failed to record result for ${row.job_type}:`, error.message)
}

// One dispatcher pass. CAS claim: advancing next_run_at only where it still
// equals the value we read means a concurrently polling second instance loses
// the update and skips the job — same pattern as the report claim row, done
// with the schedule slot itself.
export async function runDueJobs(limit = 10): Promise<number> {
  const now = new Date()
  const { data: due, error } = await supabase
    .from('scheduled_jobs')
    .select('id, client_id, job_type, cadence, day_of_month, next_run_at')
    .eq('enabled', true)
    .lte('next_run_at', now.toISOString())
    .order('next_run_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`runDueJobs: ${error.message}`)
  if (!due?.length) return 0

  let ran = 0
  // Sequential on purpose: handlers hit paid, quota-limited APIs (DataForSEO,
  // PageSpeed, LLM providers) and the report path shares an email budget.
  for (const row of due) {
    const next = computeNextRun(row.cadence as 'daily' | 'weekly' | 'monthly', row.day_of_month, now)
    const { data: claimed } = await supabase
      .from('scheduled_jobs')
      .update({ next_run_at: next.toISOString(), last_run_at: now.toISOString() })
      .eq('id', row.id)
      .eq('next_run_at', row.next_run_at) // the CAS — lost race = someone else ran it
      .select('id')
    if (!claimed?.length) continue
    await executeJob(row)
    ran++
  }
  return ran
}

// Superadmin "run now". Doesn't touch the schedule — the regular slot stays
// where it was; this is an extra manual run on top.
export async function runJobNow(jobId: string): Promise<JobResult> {
  const { data: row, error } = await supabase
    .from('scheduled_jobs')
    .select('id, client_id, job_type')
    .eq('id', jobId)
    .single()
  if (error || !row) throw new Error('Job not found')
  await supabase.from('scheduled_jobs').update({ last_run_at: new Date().toISOString() }).eq('id', jobId)
  const def = JOB_DEFS[row.job_type]
  let result: JobResult
  try {
    result = def?.handler
      ? await def.handler(row.client_id)
      : { status: 'failed', detail: 'No handler implemented yet' }
  } catch (err) {
    result = { status: 'failed', detail: err instanceof Error ? err.message : 'Unknown error' }
  }
  await supabase.from('scheduled_jobs').update({
    last_status: result.status,
    last_error: result.status === 'ok' ? null : result.detail ?? null,
  }).eq('id', jobId)
  return result
}

// ── Superadmin overview ──────────────────────────────────────────────────────

export interface JobRow {
  id: string
  jobType: string
  label: string
  cadence: string
  enabled: boolean
  lastRunAt: string | null
  lastStatus: string | null
  lastError: string | null
  nextRunAt: string | null
  implemented: boolean
}

export interface ClientJobs {
  clientId: string
  clientName: string
  tierName: string | null
  jobs: JobRow[]
  // Entitled-to-a-deliverable-but-no-job-scheduled — the "promising something
  // we aren't delivering" check. Non-empty only when reconcile hasn't caught
  // up (or someone disabled a row by hand).
  missing: string[]
}

export async function listJobsOverview(): Promise<ClientJobs[]> {
  const clients = (await getAllClients()).filter(c => c.active)
  const { data: allJobs, error } = await supabase
    .from('scheduled_jobs')
    .select('*')
    .order('job_type')
  if (error) throw new Error(`listJobsOverview: ${error.message}`)

  const byClient = new Map<string, typeof allJobs>()
  for (const j of allJobs ?? []) {
    const list = byClient.get(j.client_id) ?? []
    list.push(j)
    byClient.set(j.client_id, list)
  }

  const out: ClientJobs[] = []
  for (const c of clients) {
    const desired = await desiredJobsFor(c.id)
    const rows = byClient.get(c.id) ?? []
    const enabledTypes = new Set(rows.filter(r => r.enabled).map(r => r.job_type as string))
    out.push({
      clientId: c.id,
      clientName: c.name,
      tierName: c.tierKey ?? null,
      jobs: rows.map(r => ({
        id: r.id,
        jobType: r.job_type,
        label: JOB_DEFS[r.job_type]?.label ?? r.job_type,
        cadence: r.cadence,
        enabled: r.enabled,
        lastRunAt: r.last_run_at,
        lastStatus: r.last_status,
        lastError: r.last_error,
        nextRunAt: r.next_run_at,
        implemented: !!JOB_DEFS[r.job_type]?.handler,
      })),
      missing: desired.filter(d => !enabledTypes.has(d.jobType)).map(d => JOB_DEFS[d.jobType]?.label ?? d.jobType),
    })
  }
  return out
}
