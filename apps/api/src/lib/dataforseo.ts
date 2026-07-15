import { supabase } from './supabase'
import { getClientById } from './clients'
import { complete } from './llm/complete'

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
function toTarget(input: string): string {
  return input.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim()
}

// DataForSEO's `checks` map is check_name -> count of pages where the check is
// TRUE, and "true" can mean good OR bad depending on the check. We only surface
// the ones where true = a problem, with a plain-English label. This is what
// keeps us from reporting "10 pages have a canonical tag" as an issue.
const PROBLEM_CHECKS: Record<string, string> = {
  no_h1_tag: 'Pages missing an H1 heading',
  duplicate_h1_tag: 'Pages with duplicate or multiple H1 tags',
  no_title: 'Pages missing a title tag',
  duplicate_title_tag: 'Pages with duplicate title tags',
  title_too_long: 'Title tags that are too long',
  title_too_short: 'Title tags that are too short',
  no_description: 'Pages missing a meta description',
  duplicate_description: 'Pages with duplicate meta descriptions',
  irrelevant_description: 'Meta descriptions that don’t match the page content',
  irrelevant_title: 'Title tags that don’t match the page content',
  no_image_alt: 'Images missing alt text',
  no_image_title: 'Images missing a title attribute',
  https_to_http_links: 'Secure pages linking to insecure HTTP URLs',
  is_http: 'Pages still served over insecure HTTP',
  broken_links: 'Broken links',
  broken_resources: 'Broken resources (images, scripts, or CSS)',
  duplicate_content: 'Pages with duplicate content',
  low_content_rate: 'Pages with very little text content',
  large_page_size: 'Pages with a heavy HTML size (slow to load)',
  high_loading_time: 'Pages with slow load times',
  high_waiting_time: 'Pages slow to respond (time to first byte)',
  is_4xx_code: 'Pages returning “not found” (4xx) errors',
  is_5xx_code: 'Pages returning server (5xx) errors',
  is_broken: 'Broken pages',
  canonical_to_broken: 'Canonical tags pointing to broken pages',
  redirect_loop: 'Redirect loops',
  no_favicon: 'Missing favicon',
  no_doctype: 'Pages missing an HTML doctype',
  deprecated_html_tags: 'Deprecated HTML tags in use',
  low_readability_rate: 'Content that’s hard to read',
  lorem_ipsum: 'Placeholder “Lorem Ipsum” text left on the page',
  has_render_blocking_resources: 'Render-blocking scripts or styles',
  no_content_encoding: 'Pages served without compression',
  seo_friendly_url_characters_check: 'URLs with unfriendly characters',
}

export interface CrawlIssue {
  severity: 'high' | 'medium' | 'low'
  title: string
  count: number
  explanation: string
}

interface ProblemCount { key: string; label: string; count: number }

export interface SeoCrawl {
  id: string
  clientId: string
  url: string
  status: 'running' | 'finished' | 'failed'
  taskId: string | null
  onpageScore: number | null
  pagesCrawled: number | null
  checks: ProblemCount[] | null
  issues: CrawlIssue[] | null
  cost: number | null
  error: string | null
  createdAt: string
  updatedAt: string
}

interface CrawlRow {
  id: string
  client_id: string
  url: string
  status: string
  task_id: string | null
  onpage_score: number | null
  pages_crawled: number | null
  checks: ProblemCount[] | null
  issues: CrawlIssue[] | null
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
  const lines = problems.map(p => `- ${p.label} (${p.key}): ${p.count}`).join('\n')
  const prompt = `You are triaging a technical SEO crawl of ${target} for a non-technical small-business owner.
Overall on-page health score: ${score ?? 'n/a'}/100.
The crawler flagged these problems (label, internal key, and number of pages/items affected):
${lines}

Return ONLY a JSON array (no prose, no code fences), most severe first, of the problems worth acting on.
Each element: {"severity": "high"|"medium"|"low", "title": short human label, "count": number affected, "explanation": one plain-English sentence on why it matters for search rankings or visitors — no jargon}.
Rank by real SEO impact (broken pages, missing/duplicate titles & H1s, insecure links, and duplicate content are usually high; missing alt text and cosmetic items are usually low). Keep at most 12.`
  try {
    const raw = await complete(prompt, { maxTokens: 900, tier: 'cheap' })
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) return null
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return null
    return parsed
      .filter((i: any) => i && typeof i.title === 'string')
      .map((i: any) => ({
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

// Kick off a crawl: post the On-Page task and record a 'running' row. If a crawl
// is already running for this client (posted < 15 min ago), returns it instead
// of posting a second task — avoids accidental double-charges from double-clicks.
export async function startCrawl(clientId: string): Promise<SeoCrawl> {
  const client = await getClientById(clientId)
  if (!client) throw new Error('Client not found')

  const source = client.portalConfig?.seoPages?.[0] ?? client.domain
  if (!source) throw new Error('No domain or SEO pages configured for this client')
  const target = toTarget(source)
  if (!target) throw new Error('Could not derive a crawl target from the client domain')

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

// Poll a running crawl. While DataForSEO is still crawling, returns the row
// unchanged. Once finished, pulls the summary, filters to real problems,
// synthesizes the issue tracker, and finalizes the row. Idempotent for terminal rows.
export async function refreshCrawl(clientId: string, crawlId: string): Promise<SeoCrawl> {
  const { data: row } = await supabase
    .from('seo_crawls')
    .select('*')
    .eq('id', crawlId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!row) throw new Error('Crawl not found')
  const crawl = row as CrawlRow
  if (crawl.status !== 'running') return fromRow(crawl)
  if (!crawl.task_id) return finalizeFailed(crawlId, 'No DataForSEO task id on record')

  // Give up on a crawl that never finishes rather than polling forever.
  if (Date.now() - new Date(crawl.created_at).getTime() > CRAWL_TIMEOUT_MS) {
    return finalizeFailed(crawlId, 'Crawl timed out before DataForSEO finished')
  }

  const summary = await dfs('/on_page/summary', [{ id: crawl.task_id }])
  const result = summary.tasks?.[0]?.result?.[0]
  const progress = result?.crawl_progress
  const pagesCrawled = result?.crawl_status?.pages_crawled ?? null

  if (progress !== 'finished') {
    if (pagesCrawled != null) {
      await supabase.from('seo_crawls').update({ pages_crawled: pagesCrawled, updated_at: new Date().toISOString() }).eq('id', crawlId)
    }
    return { ...fromRow(crawl), pagesCrawled }
  }

  const onpageScore = result?.page_metrics?.onpage_score ?? null
  const rawChecks: Record<string, number> = result?.page_metrics?.checks ?? {}
  const problems: ProblemCount[] = Object.entries(PROBLEM_CHECKS)
    .filter(([key]) => Number(rawChecks[key]) > 0)
    .map(([key, label]) => ({ key, label, count: Number(rawChecks[key]) }))
    .sort((a, b) => b.count - a.count)

  const issues = await synthesize(crawl.url, onpageScore, problems)

  const { data, error } = await supabase
    .from('seo_crawls')
    .update({
      status: 'finished',
      onpage_score: onpageScore,
      pages_crawled: pagesCrawled,
      checks: problems,
      issues,
      updated_at: new Date().toISOString(),
    })
    .eq('id', crawlId)
    .select()
    .single()
  if (error) throw new Error(`Failed to finalize crawl: ${error.message}`)
  return fromRow(data as CrawlRow)
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
