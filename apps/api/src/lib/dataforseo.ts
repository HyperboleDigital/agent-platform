import { supabase } from './supabase'
import { getClientById } from './clients'
import { complete } from './llm/complete'
import { checkAiSearch, type AiSearchResult } from './ai-search'
import { normalizeDomain, isPublicHost } from '@agent-platform/shared'

// Phase 0 of the SEO-automation plan (docs/plans/seo-automation.md).
// Crawls a client's site via DataForSEO's On-Page API (~$0.002/page), stores
// the SEMrush-style 0-100 onpage_score + a Haiku-synthesized severity-ranked
// issue tracker. The crawl runs async on DataForSEO's side; we model it as a
// pull-based job (startCrawl posts the task, refreshCrawl polls + finalizes)
// so we don't need a background worker yet — the dashboard drives the polling.

const BASE = 'https://api.dataforseo.com/v3'
const MAX_CRAWL_PAGES = Number(process.env.DATAFORSEO_MAX_PAGES ?? 25)
const CRAWL_TIMEOUT_MS = 10 * 60 * 1000 // give up on a stuck crawl after 10 min

export function crawlConfigured(): boolean {
  return !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD)
}

function authHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN ?? ''
  const pass = process.env.DATAFORSEO_PASSWORD ?? ''
  return 'Basic ' + Buffer.from(`${login}:${pass}`).toString('base64')
}

async function dfs(path: string, body?: unknown): Promise<any> {
  const res = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json() as any
  if (json.status_code !== 20000) {
    throw new Error(`DataForSEO ${path}: ${json.status_code} ${json.status_message}`)
  }
  return json
}

// Reduce a URL/domain to the bare host DataForSEO wants as a crawl target.
// `isPublicHost` (imported above) rejects loopback/dev/private targets before
// they're ever posted — otherwise the crawl just spins until the 10-minute
// timeout with no useful error. This is exactly what a client whose `domain`
// was left as "localhost" hit: every audit "ran" then failed.
const toTarget = normalizeDomain

// DataForSEO's `checks` map is check_name -> count of pages where the check is
// TRUE, and "true" can mean good OR bad depending on the check. We only surface
// the ones where true = a problem, with a plain-English label. This is what
// keeps us from reporting "10 pages have a canonical tag" as an issue.
// Only checks where `true` = a real problem (DataForSEO also returns many
// positive/neutral checks like seo_friendly_url, is_https, canonical — those are
// NOT problems and must be excluded). Keys verified against DataForSEO's actual
// On-Page vocabulary (57 checks). Grouped for readability.
const PROBLEM_CHECKS: Record<string, string> = {
  // Titles & meta
  no_title: 'Pages missing a title tag',
  duplicate_title_tag: 'Pages with duplicate title tags',
  title_too_long: 'Title tags that are too long',
  title_too_short: 'Title tags that are too short',
  irrelevant_title: 'Title tags that don’t match the page content',
  no_description: 'Pages missing a meta description',
  duplicate_meta_tags: 'Pages with duplicate meta descriptions',
  irrelevant_description: 'Meta descriptions that don’t match the page content',
  irrelevant_meta_keywords: 'Irrelevant meta keywords',
  // Structure & markup
  no_h1_tag: 'Pages missing an H1 heading',
  no_doctype: 'Pages missing an HTML doctype',
  no_encoding_meta_tag: 'Pages missing a charset meta tag',
  deprecated_html_tags: 'Deprecated HTML tags in use',
  flash: 'Obsolete Flash content',
  no_favicon: 'Missing favicon',
  // Content
  low_content_rate: 'Pages with very little text content',
  low_character_count: 'Pages with a very low word count',
  low_readability_rate: 'Content that’s hard to read',
  lorem_ipsum: 'Placeholder “Lorem Ipsum” text left on the page',
  // Images
  no_image_alt: 'Images missing alt text',
  no_image_title: 'Images missing a title attribute',
  // Security
  is_http: 'Pages served over insecure HTTP',
  https_to_http_links: 'Secure pages linking to insecure HTTP URLs',
  // Links & crawlability
  is_4xx_code: 'Pages returning “not found” (4xx) errors',
  is_5xx_code: 'Pages returning server (5xx) errors',
  is_broken: 'Broken pages',
  is_orphan_page: 'Orphan pages (no internal links point to them)',
  has_links_to_redirects: 'Internal links that point to redirects',
  // Canonicals & redirects
  canonical_to_broken: 'Canonical tags pointing to broken pages',
  canonical_to_redirect: 'Canonical tags pointing to redirects',
  canonical_chain: 'Canonical chains',
  recursive_canonical: 'Recursive (looping) canonical tags',
  redirect_chain: 'Redirect chains',
  has_meta_refresh_redirect: 'Pages using a meta-refresh redirect',
  // Performance
  large_page_size: 'Pages with a heavy HTML size',
  size_greater_than_3mb: 'Pages larger than 3MB',
  high_loading_time: 'Pages with slow load times',
  high_waiting_time: 'Pages slow to respond (time to first byte)',
  has_render_blocking_resources: 'Render-blocking scripts or styles',
  no_content_encoding: 'Pages served without compression',
}

export interface CrawlIssue {
  key?: string
  severity: 'high' | 'medium' | 'low'
  title: string
  count: number
  explanation: string
  urls?: string[]
}

interface ProblemCount { key: string; label: string; count: number; urls: string[] }

const MAX_URLS_PER_ISSUE = 25

export interface SeoCrawl {
  id: string
  clientId: string | null
  url: string
  status: 'running' | 'finished' | 'failed'
  taskId: string | null
  onpageScore: number | null
  pagesCrawled: number | null
  checks: ProblemCount[] | null
  issues: CrawlIssue[] | null
  aiSearch: AiSearchResult | null
  cost: number | null
  error: string | null
  createdAt: string
  updatedAt: string
}

interface CrawlRow {
  id: string
  client_id: string | null
  url: string
  status: string
  task_id: string | null
  onpage_score: number | null
  pages_crawled: number | null
  checks: ProblemCount[] | null
  issues: CrawlIssue[] | null
  ai_search: AiSearchResult | null
  cost: number | null
  error: string | null
  created_at: string
  updated_at: string
}

function fromRow(r: CrawlRow): SeoCrawl {
  return {
    id: r.id,
    clientId: r.client_id,
    url: r.url,
    status: r.status as SeoCrawl['status'],
    taskId: r.task_id,
    onpageScore: r.onpage_score,
    pagesCrawled: r.pages_crawled,
    checks: r.checks,
    issues: r.issues,
    aiSearch: r.ai_search,
    cost: r.cost,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

// Turn the raw problem counts into a severity-ranked, plain-English tracker via
// a cheap model. Non-fatal: if synthesis fails (e.g. low LLM credits), the audit
// still saves with its score + raw problem list — the tracker just stays null.
async function synthesize(target: string, score: number | null, problems: ProblemCount[]): Promise<CrawlIssue[] | null> {
  if (problems.length === 0) return []
  const lines = problems.map(p => `- ${p.label} (key: ${p.key}): ${p.count}`).join('\n')
  const prompt = `You are triaging a technical SEO crawl of ${target} for a non-technical small-business owner.
Overall on-page health score: ${score ?? 'n/a'}/100.
The crawler flagged these problems (label, internal key, number of pages/items affected):
${lines}

Return ONLY a JSON array (no prose, no code fences), most severe first, with exactly ONE object per problem above (do not merge or drop any).
Each element: {"key": the exact internal key given, "severity": "high"|"medium"|"low", "title": short human label, "count": number affected, "explanation": one plain-English sentence on why it matters for search rankings or visitors — no jargon}.
Rank by real SEO impact: broken pages, missing/duplicate titles & H1s, insecure links, and duplicate content are usually high; missing alt text and cosmetic items are usually low.`
  try {
    const raw = await complete(prompt, { maxTokens: 1000, tier: 'cheap' })
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) return null
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return null
    return parsed
      .filter((i: any) => i && typeof i.title === 'string')
      .map((i: any) => ({
        key: typeof i.key === 'string' ? i.key : undefined,
        severity: ['high', 'medium', 'low'].includes(i.severity) ? i.severity : 'medium',
        title: String(i.title),
        count: Number(i.count) || 0,
        explanation: String(i.explanation ?? ''),
      }))
  } catch (err) {
    console.error('[dataforseo] issue synthesis failed', err instanceof Error ? err.message : err)
    return null
  }
}

// Fetch per-page data and map each problem check to the exact URLs affected.
// Retrieval is free (the crawl was already billed at task_post), so this adds
// the agency-spreadsheet "which pages" column at no extra cost.
async function fetchAffectedUrls(taskId: string): Promise<Record<string, string[]>> {
  const byCheck: Record<string, string[]> = {}
  try {
    const res = await dfs('/on_page/pages', [{ id: taskId, limit: 1000 }])
    const items: any[] = res.tasks?.[0]?.result?.[0]?.items ?? []
    for (const item of items) {
      const url: string | undefined = item?.url
      const checks: Record<string, boolean> = item?.checks ?? {}
      if (!url) continue
      for (const key of Object.keys(PROBLEM_CHECKS)) {
        if (checks[key]) (byCheck[key] ??= []).push(url)
      }
    }
  } catch (err) {
    console.error('[dataforseo] fetchAffectedUrls failed', err instanceof Error ? err.message : err)
  }
  return byCheck
}

// Kick off a crawl: post the On-Page task and record a 'running' row. If a crawl
// is already running for this client (posted < 15 min ago), returns it instead
// of posting a second task — avoids accidental double-charges from double-clicks.
export async function startCrawl(clientId: string): Promise<SeoCrawl> {
  const client = await getClientById(clientId)
  if (!client) throw new Error('Client not found')

  const source = client.portalConfig?.seoPages?.[0] ?? client.domain
  if (!source) throw new Error('No domain or SEO pages configured for this client')
  const target = toTarget(source)
  if (!isPublicHost(target)) {
    throw new Error(`Can't audit "${target}" — it isn't a public website. Set this client's domain to a live public URL before running an audit.`)
  }

  const { data: running } = await supabase
    .from('seo_crawls')
    .select('*')
    .eq('client_id', clientId)
    .eq('status', 'running')
    .gte('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (running) return fromRow(running as CrawlRow)

  const post = await dfs('/on_page/task_post', [{
    target,
    max_crawl_pages: MAX_CRAWL_PAGES,
    load_resources: true,
    enable_javascript: true,
  }])
  const task = post.tasks?.[0]
  const taskId = task?.id
  if (!taskId) throw new Error('DataForSEO did not return a task id')
  const cost = task?.cost ?? post.cost ?? null

  const { data, error } = await supabase
    .from('seo_crawls')
    .insert({ client_id: clientId, url: target, status: 'running', task_id: taskId, cost })
    .select()
    .single()
  if (error) throw new Error(`Failed to record crawl: ${error.message}`)
  return fromRow(data as CrawlRow)
}

// Poll a running crawl (client-scoped). Thin wrapper over finalizeIfNeeded.
export async function refreshCrawl(clientId: string, crawlId: string): Promise<SeoCrawl> {
  const { data: row } = await supabase
    .from('seo_crawls')
    .select('*')
    .eq('id', crawlId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!row) throw new Error('Crawl not found')
  return finalizeIfNeeded(row as CrawlRow)
}

// Shared poll+finalize for both client-scoped and ad-hoc crawls. While
// DataForSEO is still crawling, returns the row unchanged; once finished, pulls
// the summary, filters to real problems, synthesizes the issue tracker, and
// finalizes the row. Idempotent for terminal rows. Keyed off the row itself, so
// tenant scoping stays an auth concern at the route layer.
async function finalizeIfNeeded(crawl: CrawlRow): Promise<SeoCrawl> {
  if (crawl.status !== 'running') return fromRow(crawl)
  if (!crawl.task_id) return finalizeFailed(crawl.id, 'No DataForSEO task id on record')

  // Give up on a crawl that never finishes rather than polling forever.
  if (Date.now() - new Date(crawl.created_at).getTime() > CRAWL_TIMEOUT_MS) {
    return finalizeFailed(crawl.id, 'Crawl timed out before DataForSEO finished')
  }

  const summary = await dfs('/on_page/summary', [{ id: crawl.task_id }])
  const result = summary.tasks?.[0]?.result?.[0]
  const progress = result?.crawl_progress
  const pagesCrawled = result?.crawl_status?.pages_crawled ?? null

  if (progress !== 'finished') {
    if (pagesCrawled != null) {
      await supabase.from('seo_crawls').update({ pages_crawled: pagesCrawled, updated_at: new Date().toISOString() }).eq('id', crawl.id)
    }
    return { ...fromRow(crawl), pagesCrawled }
  }

  const onpageScore = result?.page_metrics?.onpage_score ?? null
  const rawChecks: Record<string, number> = result?.page_metrics?.checks ?? {}
  const urlsByCheck = await fetchAffectedUrls(crawl.task_id)
  const problems: ProblemCount[] = Object.entries(PROBLEM_CHECKS)
    .filter(([key]) => Number(rawChecks[key]) > 0)
    .map(([key, label]) => ({ key, label, count: Number(rawChecks[key]), urls: (urlsByCheck[key] ?? []).slice(0, MAX_URLS_PER_ISSUE) }))
    .sort((a, b) => b.count - a.count)

  const synthesized = await synthesize(crawl.url, onpageScore, problems)
  // Attach the affected URLs to each synthesized issue via its check key.
  const issues: CrawlIssue[] | null = synthesized?.map(i => ({
    ...i,
    urls: i.key ? (urlsByCheck[i.key] ?? []).slice(0, MAX_URLS_PER_ISSUE) : undefined,
  })) ?? null

  // AI Search Health (GEO) — cheap robots.txt/llms.txt check. Non-fatal.
  let aiSearch: AiSearchResult | null = null
  try {
    aiSearch = await checkAiSearch(crawl.url)
  } catch (err) {
    console.error('[dataforseo] AI search check failed', err instanceof Error ? err.message : err)
  }

  const { data, error } = await supabase
    .from('seo_crawls')
    .update({
      status: 'finished',
      onpage_score: onpageScore,
      pages_crawled: pagesCrawled,
      checks: problems,
      issues,
      ai_search: aiSearch,
      updated_at: new Date().toISOString(),
    })
    .eq('id', crawl.id)
    .select()
    .single()
  if (error) throw new Error(`Failed to finalize crawl: ${error.message}`)
  return fromRow(data as CrawlRow)
}

// ── Ad-hoc audits: crawl ANY url, not tied to a client (superadmin tool) ──────
// Same engine, client_id = null. Lets a superadmin audit a prospect's site on
// demand. No public exposure, no automation.
export async function startAdhocCrawl(rawTarget: string): Promise<SeoCrawl> {
  const target = toTarget(rawTarget)
  if (!isPublicHost(target)) throw new Error('Enter a valid public website URL or domain — localhost and private addresses can’t be crawled.')

  const { data: running } = await supabase
    .from('seo_crawls')
    .select('*')
    .is('client_id', null)
    .eq('url', target)
    .eq('status', 'running')
    .gte('created_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (running) return fromRow(running as CrawlRow)

  const post = await dfs('/on_page/task_post', [{
    target,
    max_crawl_pages: MAX_CRAWL_PAGES,
    load_resources: true,
    enable_javascript: true,
  }])
  const task = post.tasks?.[0]
  const taskId = task?.id
  if (!taskId) throw new Error('DataForSEO did not return a task id')
  const cost = task?.cost ?? post.cost ?? null

  const { data, error } = await supabase
    .from('seo_crawls')
    .insert({ client_id: null, url: target, status: 'running', task_id: taskId, cost })
    .select()
    .single()
  if (error) throw new Error(`Failed to record crawl: ${error.message}`)
  return fromRow(data as CrawlRow)
}

export async function refreshAdhocCrawl(crawlId: string): Promise<SeoCrawl> {
  const { data: row } = await supabase
    .from('seo_crawls')
    .select('*')
    .eq('id', crawlId)
    .is('client_id', null)
    .maybeSingle()
  if (!row) throw new Error('Audit not found')
  return finalizeIfNeeded(row as CrawlRow)
}

export async function listAdhocCrawls(limit = 20): Promise<SeoCrawl[]> {
  const { data } = await supabase
    .from('seo_crawls')
    .select('*')
    .is('client_id', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  return (data ?? []).map(r => fromRow(r as CrawlRow))
}

async function finalizeFailed(crawlId: string, message: string): Promise<SeoCrawl> {
  const { data } = await supabase
    .from('seo_crawls')
    .update({ status: 'failed', error: message, updated_at: new Date().toISOString() })
    .eq('id', crawlId)
    .select()
    .single()
  return fromRow(data as CrawlRow)
}

// Abandon a crawl that's stuck 'running' (e.g. the dashboard's poll loop died
// — a reload or navigation — before DataForSEO finished, leaving the row, and
// the UI's disabled button, stuck forever). We don't cancel the DataForSEO task
// itself (there's no such API and it's already been paid for); we just release
// our record so the operator can start a fresh crawl. Idempotent for terminal
// rows.
export async function cancelCrawl(clientId: string, crawlId: string): Promise<SeoCrawl> {
  const { data: row } = await supabase
    .from('seo_crawls')
    .select('*')
    .eq('id', crawlId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!row) throw new Error('Crawl not found')
  if ((row as CrawlRow).status !== 'running') return fromRow(row as CrawlRow)
  return finalizeFailed(crawlId, 'Canceled')
}

export async function getCrawl(clientId: string, crawlId: string): Promise<SeoCrawl | null> {
  const { data } = await supabase
    .from('seo_crawls')
    .select('*')
    .eq('id', crawlId)
    .eq('client_id', clientId)
    .maybeSingle()
  return data ? fromRow(data as CrawlRow) : null
}

export async function getLatestCrawl(clientId: string): Promise<SeoCrawl | null> {
  const { data } = await supabase
    .from('seo_crawls')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? fromRow(data as CrawlRow) : null
}

// Every finished crawl for a client within the last `days`, oldest→newest — used
// to build the report's on-page-score trend. This is the single source of SEO
// scoring now that the separate PageSpeed audit is gone.
export async function getCrawlHistory(clientId: string, days = 400): Promise<SeoCrawl[]> {
  const since = new Date()
  since.setDate(since.getDate() - days)
  const { data } = await supabase
    .from('seo_crawls')
    .select('*')
    .eq('client_id', clientId)
    .eq('status', 'finished')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true })
  return ((data as CrawlRow[] | null) ?? []).map(fromRow)
}

// Finalize any crawl still 'running'. Called on a timer from the server (see
// index.ts) so a crawl completes even when no dashboard tab is open to poll it —
// this platform has no scheduler, and the browser-only polling it used to rely
// on is exactly what left crawls hung. finalizeIfNeeded is idempotent and
// self-limiting (it trips the 10-min timeout on genuinely stuck rows), so this
// is safe to run repeatedly.
export async function finalizePendingCrawls(): Promise<void> {
  const { data } = await supabase
    .from('seo_crawls')
    .select('*')
    .eq('status', 'running')
    .order('created_at', { ascending: true })
    .limit(20)
  for (const row of (data as CrawlRow[] | null) ?? []) {
    try {
      await finalizeIfNeeded(row)
    } catch (err) {
      console.error('[dataforseo] finalizePendingCrawls error', err instanceof Error ? err.message : err)
    }
  }
}

// ── Map-pack rank tracking ──────────────────────────────────────────────
// Checks where a business sits in the Google Maps 3-pack for a keyword, from
// a simulated location. Unlike GBP posts/photos, this is a real SERP result
// DataForSEO can fetch live — no Google approval needed, reuses the same
// account already paying for on-page crawls.

export interface MapRankResult {
  keyword: string
  location: string
  rankAbsolute: number | null // null = not found in the top results checked
  checkedAt: string
}

export async function checkMapPackRank(keyword: string, location: string, placeId: string | null, businessName: string): Promise<MapRankResult> {
  const json = await dfs('/serp/google/maps/live/advanced', [{
    keyword,
    location_name: location,
    language_code: 'en',
    depth: 20
  }])

  const items = (json.tasks?.[0]?.result?.[0]?.items ?? []) as any[]
  // Prefer an exact place_id match; without one (no Place ID recorded yet),
  // fall back to matching on the business name — an approximation, not proof.
  const match = placeId
    ? items.find(i => i.place_id === placeId)
    : items.find(i => typeof i.title === 'string' && i.title.toLowerCase().includes(businessName.toLowerCase()))

  return {
    keyword,
    location,
    rankAbsolute: match?.rank_absolute ?? null,
    checkedAt: new Date().toISOString()
  }
}

// ── Target-keyword organic rank tracking ────────────────────────────────
// Where a client's site ranks in Google's *organic* (blue-link) results for a
// keyword they want to rank for. Same DataForSEO account as the crawl; the
// organic SERP live endpoint returns ranked results we scan for the client's
// own domain. Defaults to a US national search — organic intent is usually
// national, unlike the map-pack which is inherently local. (Per-client organic
// location is a future refinement; see TODO.md.)
export const DEFAULT_ORGANIC_LOCATION = 'United States'

export interface OrganicRankResult {
  rankAbsolute: number | null // null = our domain wasn't in the results checked
  url: string | null
}

export async function checkOrganicRank(keyword: string, domain: string, location = DEFAULT_ORGANIC_LOCATION): Promise<OrganicRankResult> {
  const host = normalizeDomain(domain)
  const json = await dfs('/serp/google/organic/live/advanced', [{
    keyword,
    location_name: location,
    language_code: 'en',
    depth: 100
  }])

  const items = (json.tasks?.[0]?.result?.[0]?.items ?? []) as any[]
  // The organic result whose domain is the client's — DataForSEO tags each
  // ranked item with a `domain`; match on the normalized host so www/subpaths
  // don't cause misses.
  const match = items.find(i =>
    i.type === 'organic' &&
    typeof i.domain === 'string' &&
    normalizeDomain(i.domain) === host
  )

  return {
    rankAbsolute: match?.rank_absolute ?? null,
    url: match?.url ?? null
  }
}

// ── Keyword research (SEMrush-style) ────────────────────────────────────
// Expands a seed phrase into long-tail keyword ideas, each with its monthly
// search volume and keyword difficulty (0-100). Uses DataForSEO Labs'
// keyword_suggestions (full-text: every idea CONTAINS the seed), which is
// exactly what surfaces winnable local long-tail — seed "web design tampa"
// returns "affordable web design tampa", "tampa web design company", etc.
// Same account as the crawl/rank tracking; no new vendor.

export interface KeywordIdea {
  keyword: string
  searchVolume: number | null
  difficulty: number | null // 0-100; lower = easier to rank
  cpc: number | null
}

export async function researchKeywords(seed: string, location = DEFAULT_ORGANIC_LOCATION, limit = 50): Promise<KeywordIdea[]> {
  const json = await dfs('/dataforseo_labs/google/keyword_suggestions/live', [{
    keyword: seed.trim().toLowerCase(),
    location_name: location,
    language_code: 'en',
    include_seed_keyword: true,
    limit,
    order_by: ['keyword_info.search_volume,desc']
  }])

  const items = (json.tasks?.[0]?.result?.[0]?.items ?? []) as any[]
  return items.map(item => {
    // Labs endpoints vary in nesting — the metrics live either directly on the
    // item or under `keyword_data`. Read defensively so a shape change doesn't
    // silently null everything.
    const info = item.keyword_info ?? item.keyword_data?.keyword_info
    const props = item.keyword_properties ?? item.keyword_data?.keyword_properties
    return {
      keyword: item.keyword ?? item.keyword_data?.keyword ?? '',
      searchVolume: info?.search_volume ?? null,
      difficulty: props?.keyword_difficulty ?? null,
      cpc: info?.cpc ?? null
    }
  }).filter(k => k.keyword)
}
