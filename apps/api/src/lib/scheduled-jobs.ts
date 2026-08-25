import { supabase } from './supabase'
import { getAllClients, getClientById } from './clients'
import { getEntitlements } from './entitlements'
import { tierForKey } from './tiers'
import { deliverMonthlyReport, previousPeriodKey } from './report-scheduler'
import { startCrawl, crawlConfigured } from './dataforseo'
import { checkKeywordRanks } from './seo-keywords'
import { runVisibilityChecks } from './visibility'
import { snapshotGsc, gscConfigured } from './gsc'
import { snapshotAds, googleAdsConfigured } from './google-ads'
import { listGbpActivity } from './local-presence'
import { getLatestSiteHealth, recordSiteHealthCheck } from './site-health'
import { rankCheckPrereqGap, visibilityPrereqGap } from './setup-status'
import { verifySeoFixes } from './seo-fixes'
import { generateBriefs } from './content-briefs'

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

export type JobStatus = 'ok' | 'partial' | 'failed' | 'budget_exceeded' | 'setup_incomplete'

export interface JobResult {
  status: JobStatus
  detail?: string
  // What this run actually cost, in cents. Real vendor-reported cost where one
  // exists (DataForSEO returns it), a documented conservative estimate for the
  // SERP/LLM legs. Feeds the per-client monthly budget below.
  costCents?: number
  // Small structured payload for the run history / "This month" panel.
  summary?: Record<string, unknown>
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

// ── Cost + budget ────────────────────────────────────────────────────────────

// Estimates for calls whose vendors don't hand back a cost. Deliberately on
// the high side — the budget exists to stop runaway spend, so overestimating
// fails safe. DataForSEO SERP: ~$0.002/check. Visibility: one web-search LLM
// call + one judge call per provider leg — call it a cent.
const SERP_COST_CENTS = 0.2
const VISIBILITY_COST_CENTS_PER_LEG = 1

// Jobs that spend real money per run and therefore respect the budget. The
// rest (uptime, GSC, report generation, reconciliation-style checks) are free
// or effectively free and always run.
const PAID_JOB_TYPES = new Set(['crawl', 'rank_check', 'visibility_poll', 'local_pack_check'])

const DEFAULT_JOB_BUDGET_CENTS = 500 // $5/client/month unless overridden

async function monthSpendCents(clientId: string, now = new Date()): Promise<number> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const { data, error } = await supabase
    .from('job_runs')
    .select('cost_cents')
    .eq('client_id', clientId)
    .gte('started_at', monthStart.toISOString())
  if (error) {
    // Migration not applied yet (migrate_2026-08-25_job-runs.sql): behave as
    // before the budget existed rather than silently pausing every paid job.
    if (/job_runs/.test(error.message) && /find|exist|schema cache/i.test(error.message)) {
      console.warn('[jobs] job_runs table missing — run migrate_2026-08-25_job-runs.sql; budget not enforced until then')
      return 0
    }
    // Any other failure: fail CLOSED for paid jobs — if we can't read spend,
    // report over-budget rather than risking unmetered paid calls.
    console.error('[jobs] monthSpendCents failed:', error.message)
    return Number.MAX_SAFE_INTEGER
  }
  return (data ?? []).reduce((sum, r) => sum + Number(r.cost_cents ?? 0), 0)
}

async function budgetFor(clientId: string): Promise<number> {
  const client = await getClientById(clientId)
  const configured = client?.portalConfig?.jobBudgetCents
  return typeof configured === 'number' && configured >= 0 ? configured : DEFAULT_JOB_BUDGET_CENTS
}

export interface BudgetStatus {
  budgetCents: number
  spentCents: number
  overBudget: boolean
}

export async function getBudgetStatus(clientId: string): Promise<BudgetStatus> {
  const [budgetCents, spentCents] = await Promise.all([budgetFor(clientId), monthSpendCents(clientId)])
  return { budgetCents, spentCents, overBudget: spentCents >= budgetCents }
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
  return {
    status: 'ok',
    detail: `Crawl ${crawl.status} (${crawl.url})`,
    // DataForSEO reports the real cost (in dollars) at task-post time.
    costCents: crawl.cost != null ? crawl.cost * 100 : 0,
    summary: { crawlId: crawl.id, url: crawl.url, crawlStatus: crawl.status }
  }
}

async function runRankCheck(clientId: string): Promise<JobResult> {
  // Not a silent skip: no tracked keywords means the Care report's block 2
  // can't render and the upsell engine is dead. Onboarding is supposed to
  // configure keywords for EVERY tier — surface the gap as setup_incomplete
  // (the setup checklist, handoff #3 §2, is the fix path).
  const rankGap = await rankCheckPrereqGap(clientId)
  if (rankGap) return { status: 'setup_incomplete', detail: rankGap }
  const checked = await checkKeywordRanks(clientId)
  const ranked = checked.filter(k => k.latestRank !== null).length
  return {
    status: 'ok',
    detail: `${checked.length} keywords checked, ${ranked} ranking`,
    costCents: checked.length * SERP_COST_CENTS,
    summary: { keywordsChecked: checked.length, ranking: ranked }
  }
}

async function runVisibilityPoll(clientId: string): Promise<JobResult> {
  const visGap = await visibilityPrereqGap(clientId)
  if (visGap) return { status: 'setup_incomplete', detail: visGap }
  const runs = await runVisibilityChecks(clientId)
  const mentioned = runs.filter(r => r.mentioned).length
  return {
    status: 'ok',
    detail: `${runs.length} checks, mentioned in ${mentioned}`,
    costCents: runs.length * VISIBILITY_COST_CENTS_PER_LEG,
    summary: { checks: runs.length, mentioned }
  }
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
  // Draft-only (handoff #3 §6): generation is scheduled; the SEND stays a
  // superadmin click in the dashboard. deliverMonthlyReport without
  // sendEmail generates + claims + Slack-nudges.
  const outcome = await deliverMonthlyReport(clientId, client.name, previousPeriodKey())
  const map: Record<string, JobStatus> = { sent: 'ok', drafted: 'ok', skipped: 'partial', failed: 'failed' }
  return { status: map[outcome.status] ?? 'failed', detail: outcome.detail }
}

// Content briefs (handoff #3 §4b): real unanswered customer questions +
// unranked target keywords → monthly briefs, via Haiku (cheap — call it a
// cent per brief).
async function runContentBrief(clientId: string): Promise<JobResult> {
  const { created, skipped } = await generateBriefs(clientId)
  return {
    status: 'ok',
    detail: created === 0 && skipped === 0
      ? 'No open questions or unranked keywords to brief'
      : `${created} brief(s) created${skipped ? `, ${skipped} skipped` : ''}`,
    costCents: created * 1,
    summary: { created, skipped },
  }
}

// Fix verification (handoff #3 §5): compares every done seo_fix request
// against the latest finished crawl. Free — no paid calls; runs on day 3,
// after the day-1 crawl has finished.
async function runFixVerify(clientId: string): Promise<JobResult> {
  const o = await verifySeoFixes(clientId)
  const total = o.verified + o.regressed + o.awaitingCrawl + o.unverifiable
  if (total === 0) return { status: 'ok', detail: 'No completed SEO fixes to verify', summary: { ...o } }
  return {
    // Regressions surface as 'partial' so the jobs view flags them without
    // reading as an infrastructure failure.
    status: o.regressed > 0 ? 'partial' : 'ok',
    detail: `${o.verified} verified, ${o.regressed} regressed, ${o.awaitingCrawl} awaiting next crawl, ${o.unverifiable} not crawl-verifiable`,
    summary: { ...o },
  }
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
  fix_verify: { label: 'Fix verification', description: 'Confirms shipped SEO fixes no longer flag in the latest crawl (handoff #3 §5)', handler: runFixVerify },
  content_brief: { label: 'Content briefs', description: 'Turns unanswered chatbot questions + unranked target keywords into content briefs (handoff #3 §4b)', handler: runContentBrief },
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
  crawl: 1, content_brief: 2, rank_check: 2, visibility_poll: 3, local_pack_check: 3,
  fix_verify: 3, // after the day-1 crawl has had time to finish
  chat_metrics_rollup: 4, unanswered_digest: 4, health_report: 5,
}

// The job-set-by-tier table from handoff #2 §1, derived from entitlements
// rather than tier keys so comped services provision too. Deliberate
// deviation from the table: the two chat jobs key on the `chat` entitlement
// rather than the Growth tier, because a chatbot-at-Care client (comp grant at
// downgrade) still needs chat metrics for their report's chatbot block.
export async function desiredJobsFor(clientId: string): Promise<DesiredJob[]> {
  const client = await getClientById(clientId)
  // Throw, don't return [], when the client can't be READ — getClientById
  // returns null on transient DB errors too, and treating that as "wants no
  // jobs" made reconcile disable a healthy client's entire job set.
  if (!client) throw new Error('Client not found (or lookup failed) — refusing to reconcile')
  if (!client.active) return [] // inactive clients get nothing scheduled
  const ent = await getEntitlements(clientId)
  // "No tier -> no promised deliverables" — but the tier is clients.tier_key
  // (the pricing-sheet assignment), NOT entitlements.planKey, which only
  // exists for clients with a Stripe subscription row. Gating on planKey alone
  // silently provisioned ZERO jobs for any tier-assigned client who hadn't
  // been through Stripe checkout — i.e. every newly onboarded client (caught
  // live 2026-08-25 while verifying handoff #3 §1).
  if (!tierForKey(client.tierKey) && !ent.planKey) return []

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
      // Weekly on the SEO+GEO tier (handoff #3 §1c) — the tier's citation
      // tracking needs trend data, not one point a month. Care keeps monthly.
      { jobType: 'visibility_poll', cadence: 'weekly' },
      { jobType: 'gsc_sync', cadence: 'weekly' },
      // The SEO+GEO loop-closers (handoff #3): verify shipped fixes against
      // the fresh monthly crawl; draft content briefs from real customer
      // questions + unranked target keywords.
      { jobType: 'fix_verify', cadence: 'monthly' },
      { jobType: 'content_brief', cadence: 'monthly' },
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
  let existingRes = await supabase
    .from('scheduled_jobs')
    .select('id, job_type, cadence, day_of_month, enabled, admin_disabled, admin_added')
    .eq('client_id', clientId)
  // The admin_* flags predate migrate_2026-08-25d on some environments — fall
  // back to the old column set (manual control simply isn't sticky until then).
  if (existingRes.error && /admin_disabled|admin_added/.test(existingRes.error.message)) {
    existingRes = await supabase
      .from('scheduled_jobs')
      .select('id, job_type, cadence, day_of_month, enabled')
      .eq('client_id', clientId) as typeof existingRes
  }
  const { data: existing, error } = existingRes
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
    // A superadmin explicitly turned this job off for this client — leave it
    // alone. The UI's enable action clears the flag, at which point reconcile
    // resumes managing the row (incl. fixing a stale cadence).
    if (have.admin_disabled) continue
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
    // Hand-scheduled rows (admin_added) live outside the entitlement contract
    // — reconcile never disables them.
    if (row.admin_added) continue
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

// Runs one job with full job_runs bookkeeping: insert a 'running' row up
// front (a crash leaves it visible; the sweep below fails it after 30min),
// budget-gate paid jobs, run the handler, finalize the run row and the
// scheduled_jobs last_* cache. Shared by the dispatcher and run-now.
async function executeJob(
  row: { id: string; client_id: string; job_type: string },
  opts: { bypassBudget?: boolean } = {}
): Promise<JobResult> {
  const def = JOB_DEFS[row.job_type]

  const { data: runRow, error: runErr } = await supabase
    .from('job_runs')
    .insert({ job_id: row.id, client_id: row.client_id, job_type: row.job_type, status: 'running' })
    .select('id')
    .single()
  if (runErr) console.error(`[jobs] failed to open run row for ${row.job_type}:`, runErr.message)

  let result: JobResult
  try {
    if (PAID_JOB_TYPES.has(row.job_type) && !opts.bypassBudget) {
      const budget = await getBudgetStatus(row.client_id)
      if (budget.overBudget) {
        result = {
          status: 'budget_exceeded',
          detail: `Monthly job budget reached ($${(budget.spentCents / 100).toFixed(2)} of $${(budget.budgetCents / 100).toFixed(2)}) — paid job skipped; raise portalConfig.jobBudgetCents or run manually`,
        }
      } else {
        result = def?.handler
          ? await def.handler(row.client_id)
          : { status: 'failed', detail: 'No handler implemented yet — this deliverable is promised but nothing delivers it' }
      }
    } else {
      result = def?.handler
        ? await def.handler(row.client_id)
        : { status: 'failed', detail: 'No handler implemented yet — this deliverable is promised but nothing delivers it' }
    }
  } catch (err) {
    result = { status: 'failed', detail: err instanceof Error ? err.message : 'Unknown error' }
  }

  if (runRow?.id) {
    const { error } = await supabase.from('job_runs').update({
      finished_at: new Date().toISOString(),
      status: result.status,
      error: result.status === 'ok' ? null : result.detail ?? null,
      cost_cents: result.costCents ?? 0,
      summary: result.summary ?? null,
    }).eq('id', runRow.id)
    if (error) console.error(`[jobs] failed to finalize run row for ${row.job_type}:`, error.message)
  }

  const { error } = await supabase.from('scheduled_jobs').update({
    last_status: result.status,
    last_error: result.status === 'ok' ? null : result.detail ?? null,
    last_cost_cents: result.costCents ?? 0,
  }).eq('id', row.id)
  if (error) console.error(`[jobs] failed to record result for ${row.job_type}:`, error.message)
  return result
}

// A run row still 'running' after 30 minutes is an abandoned crash (every
// handler finishes in seconds-to-minutes) — fail it so the history stays
// honest. Mirrors the release-stuck-crawl pattern in routes/clients.ts.
async function sweepStaleRuns(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const { error } = await supabase
    .from('job_runs')
    .update({ status: 'failed', error: 'Abandoned — never finalized (process likely restarted mid-run)', finished_at: new Date().toISOString() })
    .eq('status', 'running')
    .lt('started_at', cutoff)
  if (error) console.error('[jobs] stale-run sweep failed:', error.message)
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
  await sweepStaleRuns()
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
  // Deliberate superadmin action → bypasses the monthly budget (cost still
  // recorded against it).
  return executeJob(row, { bypassBudget: true })
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
  lastCostCents: number | null
  nextRunAt: string | null
  implemented: boolean
  // Deliberately turned off for this client by a superadmin — reconcile
  // won't re-enable it. Distinct from entitlement-driven disables.
  adminDisabled: boolean
  // Hand-scheduled outside the entitlement contract — reconcile won't
  // disable it, and it may be deleted outright.
  adminAdded: boolean
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
    const desired = await desiredJobsFor(c.id).catch(() => [] as DesiredJob[])
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
        lastCostCents: r.last_cost_cents != null ? Number(r.last_cost_cents) : null,
        nextRunAt: r.next_run_at,
        implemented: !!JOB_DEFS[r.job_type]?.handler,
        adminDisabled: !!r.admin_disabled,
        adminAdded: !!r.admin_added,
      })),
      // Deliberate opt-outs (admin_disabled) are not "missing" — that warning
      // exists for jobs a plan promises that NOBODY chose to turn off.
      missing: desired
        .filter(d => !enabledTypes.has(d.jobType))
        .filter(d => !rows.some(r => r.job_type === d.jobType && r.admin_disabled))
        .map(d => JOB_DEFS[d.jobType]?.label ?? d.jobType),
    })
  }
  return out
}

// ── Per-client automation view (superadmin card on the client SEO page) ─────

export interface JobRunRow {
  id: string
  jobType: string
  label: string
  startedAt: string
  finishedAt: string | null
  status: string
  error: string | null
  costCents: number
  summary: Record<string, unknown> | null
}

export interface ClientAutomation {
  jobs: JobRow[]
  budget: BudgetStatus
  recentRuns: JobRunRow[]
}

export async function getClientAutomation(clientId: string): Promise<ClientAutomation> {
  const [{ data: jobRows, error }, budget, { data: runRows, error: runErr }] = await Promise.all([
    supabase.from('scheduled_jobs').select('*').eq('client_id', clientId).order('job_type'),
    getBudgetStatus(clientId),
    supabase.from('job_runs').select('*').eq('client_id', clientId).order('started_at', { ascending: false }).limit(30),
  ])
  if (error) throw new Error(`getClientAutomation: ${error.message}`)
  if (runErr) console.error('[jobs] failed to load run history:', runErr.message)

  return {
    jobs: (jobRows ?? []).map(r => ({
      id: r.id,
      jobType: r.job_type,
      label: JOB_DEFS[r.job_type]?.label ?? r.job_type,
      cadence: r.cadence,
      enabled: r.enabled,
      lastRunAt: r.last_run_at,
      lastStatus: r.last_status,
      lastError: r.last_error,
      lastCostCents: r.last_cost_cents != null ? Number(r.last_cost_cents) : null,
      nextRunAt: r.next_run_at,
      implemented: !!JOB_DEFS[r.job_type]?.handler,
      adminDisabled: !!r.admin_disabled,
      adminAdded: !!r.admin_added,
    })),
    budget,
    recentRuns: (runRows ?? []).map(r => ({
      id: r.id,
      jobType: r.job_type,
      label: JOB_DEFS[r.job_type]?.label ?? r.job_type,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      status: r.status,
      error: r.error,
      costCents: Number(r.cost_cents ?? 0),
      summary: r.summary,
    })),
  }
}

// Superadmin enable/disable toggle. Disabling sets admin_disabled so the
// hourly reconcile sweep does NOT re-enable the job (a deliberate per-client
// opt-out — "this customer doesn't need weekly rank checks"); enabling clears
// the flag and hands the row back to reconcile, which also reschedules it so
// it doesn't fire instantly off a stale next_run_at.
export async function setJobEnabled(jobId: string, enabled: boolean): Promise<void> {
  const { data: row, error: readErr } = await supabase
    .from('scheduled_jobs').select('cadence, day_of_month').eq('id', jobId).single()
  if (readErr || !row) throw new Error('Job not found')
  const patch = {
    enabled,
    ...(enabled ? { next_run_at: computeNextRun(row.cadence, row.day_of_month).toISOString() } : {}),
  }
  let { error } = await supabase.from('scheduled_jobs').update({ ...patch, admin_disabled: !enabled }).eq('id', jobId)
  // Pre-migration fallback (migrate_2026-08-25d): plain toggle, not sticky.
  if (error && /admin_disabled/.test(error.message)) {
    ;({ error } = await supabase.from('scheduled_jobs').update(patch).eq('id', jobId))
  }
  if (error) throw new Error(`setJobEnabled: ${error.message}`)
}

// ── Manual scheduling (superadmin) ───────────────────────────────────────────
// Schedule any job for any client — including one with no tier yet
// (pre-onboarding). The row is marked admin_added so reconcile never disables
// it as "not entitled"; it can be deleted outright (entitlement-provisioned
// rows are only ever disabled, keeping history).

export function listJobTypes(): { jobType: string; label: string; description: string; implemented: boolean }[] {
  return Object.entries(JOB_DEFS).map(([jobType, def]) => ({
    jobType, label: def.label, description: def.description, implemented: !!def.handler,
  }))
}

export async function addClientJob(
  clientId: string,
  jobType: string,
  cadence: 'daily' | 'weekly' | 'monthly'
): Promise<void> {
  if (!JOB_DEFS[jobType]) throw new Error(`Unknown job type: ${jobType}`)
  if (!['daily', 'weekly', 'monthly'].includes(cadence)) throw new Error(`Invalid cadence: ${cadence}`)
  const dayOfMonth = cadence === 'monthly' ? MONTHLY_DAY[jobType] ?? 1 : null
  const insert = {
    client_id: clientId,
    job_type: jobType,
    cadence,
    day_of_month: dayOfMonth,
    next_run_at: computeNextRun(cadence, dayOfMonth).toISOString(),
  }
  let { error } = await supabase.from('scheduled_jobs').insert({ ...insert, admin_added: true })
  // Pre-migration fallback (migrate_2026-08-25d): schedules, but reconcile
  // may disable it later if the client isn't entitled.
  if (error && /admin_added/.test(error.message)) {
    ;({ error } = await supabase.from('scheduled_jobs').insert(insert))
  }
  if (error) {
    // 23505 = (client_id, job_type) already exists — re-enable it instead.
    if (error.code === '23505') {
      const { data: row } = await supabase.from('scheduled_jobs')
        .select('id').eq('client_id', clientId).eq('job_type', jobType).single()
      if (row) return setJobEnabled(row.id, true)
    }
    throw new Error(`addClientJob: ${error.message}`)
  }
}

// Removes a hand-scheduled row entirely. Entitlement-provisioned rows refuse
// (disable those instead — their history matters to the "promised vs
// delivered" view).
export async function removeClientJob(clientId: string, jobId: string): Promise<void> {
  const { data: row, error: readErr } = await supabase
    .from('scheduled_jobs').select('id, admin_added').eq('id', jobId).eq('client_id', clientId).single()
  if (readErr || !row) throw new Error('Job not found')
  if (!row.admin_added) throw new Error('This job is provisioned by the client\'s plan — disable it instead of deleting')
  const { error } = await supabase.from('scheduled_jobs').delete().eq('id', jobId)
  if (error) throw new Error(`removeClientJob: ${error.message}`)
}
