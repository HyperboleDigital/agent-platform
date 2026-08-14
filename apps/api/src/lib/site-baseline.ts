import { supabase } from './supabase'
import { getClientById } from './clients'
import { getLatestCrawl } from './dataforseo'

// The "technical SEO baseline" bullet on the Care tier (lib/tiers.ts).
//
// Care includes no services, so a Care client cannot see the SEO section at
// all — this is deliberately the one technical read they DO get, and it has to
// be reachable without the `seo` entitlement. That constraint is why this
// lives in its own module rather than inside the SEO section's code.
//
// Four checks, from two sources that each cover what the other can't:
//   speed, mobile  — Google PageSpeed Insights (real Lighthouse run, mobile
//                    strategy). The DataForSEO crawl reports HTML weight and
//                    server response time but never actually renders a page,
//                    so it cannot measure what a phone experiences.
//   meta, indexing — the existing DataForSEO crawl, which visits every page.
//                    PageSpeed only ever looks at the one URL it's given, so
//                    it can't tell you that 6 pages are missing descriptions.
//
// Schema markup is deliberately NOT checked here — nothing in the platform
// measures it today, and the Care bullet was reworded to stop claiming it
// rather than have this return a fabricated result.

export type CheckStatus = 'good' | 'warn' | 'poor' | 'unknown'
export type CheckKey = 'speed' | 'meta' | 'mobile' | 'indexing'

export interface BaselineCheck {
  key: CheckKey
  label: string
  status: CheckStatus
  // 0-100 where the source gives a real score; null when the check is
  // count-based (meta/indexing) or the source was unavailable.
  score: number | null
  // One plain sentence a business owner can act on — never jargon.
  detail: string
  // The specific things behind the verdict, worst first.
  findings: string[]
}

export interface SiteBaseline {
  id: string
  clientId: string
  url: string
  mobileScore: number | null
  checks: BaselineCheck[]
  createdAt: string
}

interface Row {
  id: string
  client_id: string
  url: string
  mobile_score: number | null
  checks: BaselineCheck[] | null
  created_at: string
}

function fromRow(r: Row): SiteBaseline {
  return {
    id: r.id,
    clientId: r.client_id,
    url: r.url,
    mobileScore: r.mobile_score,
    checks: r.checks ?? [],
    createdAt: r.created_at,
  }
}

export function pagespeedConfigured(): boolean {
  return !!process.env.PAGESPEED_API_KEY
}

// ── PageSpeed Insights ───────────────────────────────────────────────────────

interface PsiAudit { score: number | null; displayValue?: string; numericValue?: number }

interface PsiResult {
  performance: number | null
  // Lighthouse's SEO category score (0-1) under mobile emulation — feeds the
  // mobile check, since the dedicated mobile audits have largely been removed.
  seo: number | null
  audits: Record<string, PsiAudit>
}

// Lighthouse runs a real browser against a live site, and a slow site takes
// longer precisely because it is slow. Measured at ~98s for a two-category
// mobile run against a genuinely slow origin, so 60s silently aborted every
// time and left speed and mobile permanently 'unknown'. Three minutes gives
// real headroom while still bounding the monthly job.
const PSI_TIMEOUT_MS = 180_000

async function runPageSpeed(url: string): Promise<PsiResult | null> {
  const key = process.env.PAGESPEED_API_KEY
  if (!key) return null

  // `seo` category alongside `performance` because the mobile-friendliness
  // audits (viewport, legible font sizes, tap-target spacing) live there —
  // requesting performance alone silently returns no mobile signal at all.
  const endpoint =
    `https://www.googleapis.com/pagespeedonline/v5/runPagespeed` +
    `?url=${encodeURIComponent(url)}&strategy=mobile` +
    `&category=performance&category=seo&key=${key}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), PSI_TIMEOUT_MS)
  try {
    const res = await fetch(endpoint, { signal: controller.signal })
    const json = await res.json() as {
      error?: { message: string }
      lighthouseResult?: {
        categories?: { performance?: { score: number | null }; seo?: { score: number | null } }
        audits?: Record<string, PsiAudit>
      }
    }
    if (json.error) {
      console.warn('[baseline] PageSpeed error:', json.error.message.slice(0, 200))
      return null
    }
    const lh = json.lighthouseResult
    if (!lh) return null
    return {
      performance: lh.categories?.performance?.score != null
        ? Math.round(lh.categories.performance.score * 100)
        : null,
      seo: lh.categories?.seo?.score ?? null,
      audits: lh.audits ?? {},
    }
  } catch (err) {
    console.warn('[baseline] PageSpeed failed:', err instanceof Error ? err.message : err)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

// Lighthouse scores each audit 0-1. Below 0.5 is Google's own "poor" boundary
// and 0.9 its "good" one; reusing those keeps our wording consistent with what
// the client sees if they ever run PageSpeed themselves.
function statusFromScore(score: number | null): CheckStatus {
  if (score == null) return 'unknown'
  if (score >= 90) return 'good'
  if (score >= 50) return 'warn'
  return 'poor'
}

function speedCheck(psi: PsiResult | null): BaselineCheck {
  if (!psi || psi.performance == null) {
    return {
      key: 'speed', label: 'Page speed', status: 'unknown', score: null,
      detail: 'Speed could not be measured this time.', findings: [],
    }
  }
  const findings: string[] = []
  // Phrased as what a visitor experiences, not as a metric name — "LCP" means
  // nothing to the person reading the report.
  const lcp = psi.audits['largest-contentful-paint']
  if (lcp?.displayValue && (lcp.score ?? 1) < 0.9) {
    findings.push(`The main content takes ${lcp.displayValue} to appear on a phone.`)
  }
  const tbt = psi.audits['total-blocking-time']
  if (tbt?.displayValue && (tbt.score ?? 1) < 0.9) {
    findings.push(`The page is unresponsive to taps for ${tbt.displayValue} while loading.`)
  }
  const cls = psi.audits['cumulative-layout-shift']
  if (cls?.displayValue && (cls.score ?? 1) < 0.9) {
    findings.push(`Content shifts around as the page loads (${cls.displayValue}).`)
  }
  const status = statusFromScore(psi.performance)
  return {
    key: 'speed',
    label: 'Page speed',
    status,
    score: psi.performance,
    detail: status === 'good'
      ? 'The site loads quickly on a phone.'
      : `Mobile speed scores ${psi.performance}/100 — slow loading is one of the most common reasons visitors leave before the page appears.`,
    findings,
  }
}

// Mobile friendliness.
//
// The audit IDs here were verified against a live PageSpeed response, not
// assumed. Lighthouse has moved this ground repeatedly: `viewport` is now
// `viewport-insight`, and `font-size` and `tap-targets` no longer exist at
// all. Checking the old IDs looked fine and was silently catastrophic — every
// lookup returned undefined, no finding was ever recorded, and the check
// reported "good" for a site it had not examined.
//
// Hence the rule below: if none of the expected audits are present, this
// returns 'unknown'. A check that cannot find its inputs must say so rather
// than pass by default, because "your site is fine on phones" is a claim the
// client will act on.
const MOBILE_AUDITS = ['viewport-insight', 'viewport'] as const

function mobileCheck(psi: PsiResult | null, seoScore: number | null): BaselineCheck {
  const base = { key: 'mobile' as const, label: 'Mobile friendliness', score: null }
  if (!psi) {
    return { ...base, status: 'unknown', detail: 'Mobile friendliness could not be measured this time.', findings: [] }
  }

  const present = MOBILE_AUDITS.filter(id => psi.audits[id] != null)
  if (present.length === 0 && seoScore == null) {
    return {
      ...base, status: 'unknown',
      detail: 'The mobile checks were not returned this time, so this has not been verified.',
      findings: [],
    }
  }

  const findings: string[] = []
  if (present.some(id => psi.audits[id]?.score === 0)) {
    findings.push('The page does not tell phones how to size itself, so it renders zoomed out and text appears tiny.')
  }
  // Lighthouse's SEO category on a mobile emulation covers the crawlability and
  // readability signals that matter on a phone; below 0.9 is Google's own
  // "needs improvement" line.
  if (seoScore != null && seoScore < 0.9) {
    findings.push(`Search-readiness scores ${Math.round(seoScore * 100)}/100 on a phone — some pages have issues search engines flag on mobile.`)
  }

  const status: CheckStatus = findings.length === 0 ? 'good' : findings.length > 1 ? 'poor' : 'warn'
  return {
    ...base,
    status,
    detail: status === 'good'
      ? 'The site sizes and behaves correctly on phones.'
      : 'Some things make the site awkward to use on a phone.',
    findings,
  }
}

// Crawl-derived checks. The crawl's issue list is already severity-ranked and
// written in plain English by lib/dataforseo.ts, so these only need to select
// the issues belonging to each category rather than re-explain them.
const META_KEYS = new Set([
  'no_title', 'duplicate_title_tag', 'title_too_long', 'title_too_short', 'irrelevant_title',
  'no_description', 'duplicate_meta_tags', 'irrelevant_description', 'no_h1_tag',
])
const INDEXING_KEYS = new Set([
  'is_4xx_code', 'is_5xx_code', 'is_broken', 'is_orphan_page', 'has_links_to_redirects',
  'canonical_to_broken', 'canonical_to_redirect', 'canonical_chain', 'recursive_canonical',
  'redirect_chain', 'has_meta_refresh_redirect',
])

interface CrawlIssueLike { key?: string; title: string; count: number; explanation: string; severity: string }

function crawlCheck(
  key: 'meta' | 'indexing',
  label: string,
  keys: Set<string>,
  issues: CrawlIssueLike[] | null,
  goodDetail: string
): BaselineCheck {
  if (!issues) {
    return {
      key, label, status: 'unknown', score: null,
      detail: 'No site crawl has run yet, so this has not been checked.', findings: [],
    }
  }
  const matched = issues.filter(i => i.key && keys.has(i.key))
  if (matched.length === 0) {
    return { key, label, status: 'good', score: null, detail: goodDetail, findings: [] }
  }
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 }
  const sorted = [...matched].sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3))
  const worst = sorted[0].severity
  return {
    key,
    label,
    status: worst === 'high' ? 'poor' : 'warn',
    score: null,
    detail: `${matched.length} issue${matched.length === 1 ? '' : 's'} found across the site.`,
    findings: sorted.slice(0, 4).map(i =>
      `${i.title}${i.count > 1 ? ` (${i.count} pages)` : ''} — ${i.explanation}`
    ),
  }
}

// Runs the baseline and persists a snapshot. Never throws for a source being
// unavailable: a check whose source failed comes back 'unknown', because a
// partial baseline is still worth showing and the monthly report must not die
// because one client's site was briefly unreachable.
export async function runSiteBaseline(clientId: string): Promise<SiteBaseline> {
  const client = await getClientById(clientId)
  if (!client) throw new Error('Client not found')
  const domain = client.domain?.trim()
  if (!domain) throw new Error('This client has no domain set, so there is nothing to check')
  const url = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`

  const [psi, crawl] = await Promise.all([
    runPageSpeed(url),
    getLatestCrawl(clientId).catch(() => null),
  ])
  const issues = crawl && crawl.status === 'finished' ? (crawl.issues ?? []) : null

  const checks: BaselineCheck[] = [
    speedCheck(psi),
    mobileCheck(psi, psi?.seo ?? null),
    crawlCheck('meta', 'Titles & descriptions', META_KEYS, issues,
      'Every page has a title and description for search results.'),
    crawlCheck('indexing', 'Indexing health', INDEXING_KEYS, issues,
      'Search engines can reach and index the site without errors.'),
  ]

  const { data, error } = await supabase
    .from('site_baselines')
    .insert({ client_id: clientId, url, mobile_score: psi?.performance ?? null, checks })
    .select()
    .single()
  if (error) throw new Error(`Failed to save baseline: ${error.message}`)
  return fromRow(data as Row)
}

export async function latestBaseline(clientId: string): Promise<SiteBaseline | null> {
  const { data, error } = await supabase
    .from('site_baselines')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Failed to load baseline: ${error.message}`)
  return data ? fromRow(data as Row) : null
}

// The snapshot immediately before `before`, so the report can say "was 41, now
// 65" instead of only showing today's number.
export async function previousBaseline(clientId: string, before: string): Promise<SiteBaseline | null> {
  const { data, error } = await supabase
    .from('site_baselines')
    .select('*')
    .eq('client_id', clientId)
    .lt('created_at', before)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return null
  return data ? fromRow(data as Row) : null
}
