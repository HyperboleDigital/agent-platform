import { supabase } from './supabase'
import { getClientById } from './clients'
import { complete } from './llm/complete'

// Technical site audits via Google's free PageSpeed Insights API. Works
// without an API key (rate-limited); set PAGESPEED_API_KEY to raise the quota.

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'
const CATEGORIES = ['performance', 'seo', 'accessibility', 'best-practices'] as const

export interface AuditScores {
  performance: number
  seo: number
  accessibility: number
  bestPractices: number
}

export interface AuditMetrics {
  lcpMs?: number
  cls?: number
  inpMs?: number
  tbtMs?: number
}

interface PsiResponse {
  lighthouseResult?: {
    categories?: Record<string, { score: number | null }>
    audits?: Record<string, { numericValue?: number }>
  }
}

async function runPsi(url: string, strategy: 'mobile' | 'desktop'): Promise<{ scores: AuditScores; metrics: AuditMetrics }> {
  const params = new URLSearchParams({ url, strategy })
  for (const c of CATEGORIES) params.append('category', c)
  if (process.env.PAGESPEED_API_KEY) params.set('key', process.env.PAGESPEED_API_KEY)

  const res = await fetch(`${PSI_ENDPOINT}?${params.toString()}`)
  if (!res.ok) throw new Error(`PageSpeed Insights request failed: ${res.status}`)
  const data = (await res.json()) as PsiResponse

  const cat = data.lighthouseResult?.categories ?? {}
  const scores: AuditScores = {
    performance: Math.round((cat.performance?.score ?? 0) * 100),
    seo: Math.round((cat.seo?.score ?? 0) * 100),
    accessibility: Math.round((cat.accessibility?.score ?? 0) * 100),
    bestPractices: Math.round((cat['best-practices']?.score ?? 0) * 100)
  }

  const audits = data.lighthouseResult?.audits ?? {}
  const metrics: AuditMetrics = {
    lcpMs: audits['largest-contentful-paint']?.numericValue,
    cls: audits['cumulative-layout-shift']?.numericValue,
    inpMs: audits['interaction-to-next-paint']?.numericValue,
    tbtMs: audits['total-blocking-time']?.numericValue
  }

  return { scores, metrics }
}

async function summarize(url: string, scores: AuditScores, metrics: AuditMetrics): Promise<string> {
  const prompt = `You're summarizing a technical SEO/performance audit for a small business owner who isn't technical.
Page: ${url}
Scores (0-100): Performance ${scores.performance}, SEO ${scores.seo}, Accessibility ${scores.accessibility}, Best Practices ${scores.bestPractices}
Core Web Vitals: LCP ${metrics.lcpMs ? Math.round(metrics.lcpMs) + 'ms' : 'n/a'}, CLS ${metrics.cls ?? 'n/a'}, TBT ${metrics.tbtMs ? Math.round(metrics.tbtMs) + 'ms' : 'n/a'}

Write 3-5 short bullet points in plain English: what's good, what to fix first, and why it matters for a customer visiting the site. No jargon. No preamble.`
  return complete(prompt, { maxTokens: 400 })
}

export interface SeoAudit {
  id: string
  clientId: string
  url: string
  strategy: 'mobile' | 'desktop'
  scores: AuditScores
  metrics: AuditMetrics
  recommendations: string
  createdAt: string
}

interface AuditRow {
  id: string
  client_id: string
  url: string
  strategy: string
  scores: AuditScores
  metrics: AuditMetrics
  recommendations: string
  created_at: string
}

function fromRow(r: AuditRow): SeoAudit {
  return {
    id: r.id,
    clientId: r.client_id,
    url: r.url,
    strategy: r.strategy as 'mobile' | 'desktop',
    scores: r.scores,
    metrics: r.metrics,
    recommendations: r.recommendations,
    createdAt: r.created_at
  }
}

const MIN_RUN_INTERVAL_MS = 60 * 60 * 1000 // 1 run/hour/client

// Runs a PSI audit against every page in the client's portal_config.seoPages
// (falls back to the bare domain). Rate-limited per client, not per page.
export async function runAudits(clientId: string): Promise<SeoAudit[]> {
  const client = await getClientById(clientId)
  if (!client) throw new Error('Client not found')

  const { data: latest } = await supabase
    .from('seo_audits')
    .select('created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (latest && Date.now() - new Date(latest.created_at).getTime() < MIN_RUN_INTERVAL_MS) {
    throw new Error('An audit already ran in the last hour — try again later')
  }

  const pages = client.portalConfig?.seoPages?.length
    ? client.portalConfig.seoPages
    : client.domain
      ? [client.domain.startsWith('http') ? client.domain : `https://${client.domain}`]
      : []
  if (pages.length === 0) throw new Error('No pages configured to audit — set a domain or SEO pages first')

  const results: SeoAudit[] = []
  for (const url of pages) {
    const { scores, metrics } = await runPsi(url, 'mobile')
    const recommendations = await summarize(url, scores, metrics)
    const { data, error } = await supabase
      .from('seo_audits')
      .insert({ client_id: clientId, url, strategy: 'mobile', scores, metrics, recommendations })
      .select()
      .single()
    if (error) {
      console.error('[seo] failed to save audit', error.message)
      continue
    }
    results.push(fromRow(data as AuditRow))
  }
  return results
}

export async function getAuditHistory(clientId: string, days = 90): Promise<SeoAudit[]> {
  const since = new Date()
  since.setDate(since.getDate() - days)
  const { data, error } = await supabase
    .from('seo_audits')
    .select('*')
    .eq('client_id', clientId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
  if (error) {
    console.error('[seo] failed to load history', error.message)
    return []
  }
  return (data as AuditRow[]).map(fromRow)
}
