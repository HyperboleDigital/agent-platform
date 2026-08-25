import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { supabase } from './supabase'
import { getClientById } from './clients'
import { complete } from './llm/complete'
import { fetchAiOverview, crawlConfigured } from './dataforseo'

// AI-search visibility tracking: does ChatGPT/Claude mention this client's
// brand when asked a query a prospective customer might actually ask? Uses
// each provider's own live web-search tool (not our own SERP scraping) so the
// answer reflects what a real user would actually see.
//
// This is deliberately on cheap models — the useful signal is "mentioned or
// not, with what snippet," not conversational quality.

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const CHEAP_OPENAI_MODEL = process.env.OPENAI_CHEAP_MODEL ?? 'gpt-4o-mini'
const CHEAP_ANTHROPIC_MODEL = process.env.ANTHROPIC_CHEAP_MODEL ?? 'claude-haiku-4-5-20251001'

// Four engines (handoff #3 §4a): ChatGPT + Claude via each provider's own
// live web-search tool; Perplexity via its API (returns citations natively);
// Google AI Overviews via the existing DataForSEO SERP subscription's
// load_async_ai_overview capture. Each leg degrades gracefully when its
// key/vendor isn't configured.
export type Provider = 'openai' | 'anthropic' | 'perplexity' | 'google_aio'

interface RawAnswer {
  text: string
  // Domains the engine itself cited (Perplexity + AI Overviews return these
  // natively). undefined = the engine doesn't report citations; we fall back
  // to string-matching the answer text.
  citedDomains?: string[]
  // google_aio only: the query produced no AI Overview at all. Recorded as
  // its own signal rather than a mention=false (see runVisibilityChecks).
  noAnswer?: boolean
}

async function askOpenAI(query: string): Promise<RawAnswer> {
  const res = await openai.responses.create({
    model: CHEAP_OPENAI_MODEL,
    tools: [{ type: 'web_search' }],
    input: query
  })
  return { text: res.output_text ?? '' }
}

// The installed @anthropic-ai/sdk (0.24.3) predates typed support for the
// server-side web_search tool, but the Messages API itself accepts it
// regardless of SDK type coverage — cast the tool block through.
const PERPLEXITY_MODEL = process.env.PERPLEXITY_MODEL ?? 'sonar'

// Perplexity: OpenAI-compatible chat endpoint; citations come back natively
// (top-level `citations` — URL strings — and/or `search_results` objects).
async function askPerplexity(query: string): Promise<RawAnswer> {
  const res = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: PERPLEXITY_MODEL,
      messages: [{ role: 'user', content: query }],
      max_tokens: 1024,
    }),
  })
  if (!res.ok) throw new Error(`Perplexity API ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json() as any
  const text = json.choices?.[0]?.message?.content ?? ''
  const domains = new Set<string>()
  for (const c of json.citations ?? []) {
    if (typeof c === 'string') {
      const d = c.replace(/^https?:\/\//, '').split('/')[0]
      if (d) domains.add(d.toLowerCase().replace(/^www\./, ''))
    }
  }
  for (const r of json.search_results ?? []) {
    const d = typeof r?.url === 'string' ? r.url.replace(/^https?:\/\//, '').split('/')[0] : null
    if (d) domains.add(d.toLowerCase().replace(/^www\./, ''))
  }
  return { text, citedDomains: [...domains] }
}

async function askGoogleAio(query: string): Promise<RawAnswer> {
  const overview = await fetchAiOverview(query)
  if (!overview) return { text: '', noAnswer: true }
  return { text: overview.text, citedDomains: overview.citedDomains }
}

async function askAnthropic(query: string): Promise<RawAnswer> {
  const res = await anthropic.messages.create({
    model: CHEAP_ANTHROPIC_MODEL,
    max_tokens: 1024,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 } as never],
    messages: [{ role: 'user', content: query }]
  })
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
  return { text }
}

export interface MentionJudgement {
  mentioned: boolean
  domainCited: boolean
  snippet: string
}

// Cheap-model judge over the raw web-search answer: does it actually mention
// this brand/domain, and is there a short snippet worth showing the client?
// A plain substring match on brand name catches most cases cheaply; the LLM
// judge is the fallback for paraphrased mentions ("a local firm called...").
async function judgeMention(answerText: string, brandTerms: string[], domain: string): Promise<MentionJudgement> {
  const lower = answerText.toLowerCase()
  const domainCited = domain ? lower.includes(domain.toLowerCase().replace(/^https?:\/\//, '')) : false
  const directHit = brandTerms.some(t => t && lower.includes(t.toLowerCase()))

  if (directHit || domainCited) {
    const idx = brandTerms.map(t => lower.indexOf(t.toLowerCase())).find(i => i >= 0) ?? 0
    return { mentioned: true, domainCited, snippet: answerText.slice(Math.max(0, idx - 80), idx + 160).trim() }
  }

  // No exact match — ask a cheap model whether the brand is referenced
  // indirectly (paraphrased, described-not-named, etc).
  const prompt = `An AI search answer is below. Does it mention or clearly refer to the business "${brandTerms[0] ?? domain}"${domain ? ` (website: ${domain})` : ''}? Reply with strict JSON only: {"mentioned": boolean, "snippet": "short quote or empty string"}.

ANSWER:
${answerText.slice(0, 2000)}`
  try {
    const raw = await complete(prompt, { maxTokens: 200 })
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}')
    return { mentioned: !!parsed.mentioned, domainCited, snippet: typeof parsed.snippet === 'string' ? parsed.snippet : '' }
  } catch {
    return { mentioned: false, domainCited, snippet: '' }
  }
}

export interface VisibilityQuery {
  id: string
  clientId: string
  query: string
  active: boolean
  createdAt: string
}

interface QueryRow {
  id: string
  client_id: string
  query: string
  active: boolean
  created_at: string
}

function queryFromRow(r: QueryRow): VisibilityQuery {
  return { id: r.id, clientId: r.client_id, query: r.query, active: r.active, createdAt: r.created_at }
}

export async function listQueries(clientId: string): Promise<VisibilityQuery[]> {
  const { data, error } = await supabase.from('visibility_queries').select('*').eq('client_id', clientId).order('created_at', { ascending: true })
  if (error) { console.error('[visibility] list queries error', error.message); return [] }
  return (data as QueryRow[]).map(queryFromRow)
}

export async function addQuery(clientId: string, query: string): Promise<VisibilityQuery> {
  const { data, error } = await supabase.from('visibility_queries').insert({ client_id: clientId, query }).select().single()
  if (error) throw error
  return queryFromRow(data as QueryRow)
}

export async function removeQuery(clientId: string, queryId: string): Promise<void> {
  const { error } = await supabase.from('visibility_queries').delete().eq('client_id', clientId).eq('id', queryId)
  if (error) throw error
}

export interface VisibilityRun {
  id: string
  clientId: string
  queryId: string
  provider: Provider
  model: string | null
  mentioned: boolean
  domainCited: boolean
  snippet: string | null
  citedDomains: string[] | null
  createdAt: string
}

interface RunRow {
  id: string
  client_id: string
  query_id: string
  provider: string
  model: string | null
  mentioned: boolean
  domain_cited: boolean
  snippet: string | null
  cited_domains?: string[] | null
  created_at: string
}

function runFromRow(r: RunRow): VisibilityRun {
  return {
    id: r.id,
    clientId: r.client_id,
    queryId: r.query_id,
    provider: r.provider as Provider,
    model: r.model,
    mentioned: r.mentioned,
    domainCited: r.domain_cited,
    snippet: r.snippet,
    citedDomains: r.cited_domains ?? null,
    createdAt: r.created_at
  }
}

// Runs every active query for a client through both providers, judges
// mentions, and persists the results. If `queryId` is given, runs only that
// one query (used by the dashboard's per-query re-run action).
export async function runVisibilityChecks(clientId: string, queryId?: string): Promise<VisibilityRun[]> {
  const client = await getClientById(clientId)
  if (!client) throw new Error('Client not found')

  const brandTerms = client.portalConfig?.brandTerms?.length ? client.portalConfig.brandTerms : [client.name]
  const domain = client.domain ?? ''

  const queries = queryId
    ? (await listQueries(clientId)).filter(q => q.id === queryId)
    : (await listQueries(clientId)).filter(q => q.active)
  if (queries.length === 0) return []

  // Only run the legs that are actually configured — a missing key skips its
  // engine (logged once per run) instead of erroring every query.
  const legs: Array<[Provider, (q: string) => Promise<RawAnswer>, string | null]> = []
  if (process.env.OPENAI_API_KEY) legs.push(['openai', askOpenAI, CHEAP_OPENAI_MODEL])
  if (process.env.ANTHROPIC_API_KEY) legs.push(['anthropic', askAnthropic, CHEAP_ANTHROPIC_MODEL])
  if (process.env.PERPLEXITY_API_KEY) legs.push(['perplexity', askPerplexity, PERPLEXITY_MODEL])
  if (crawlConfigured()) legs.push(['google_aio', askGoogleAio, null])
  const skipped = (['openai', 'anthropic', 'perplexity', 'google_aio'] as Provider[]).filter(p => !legs.some(l => l[0] === p))
  if (skipped.length) console.warn(`[visibility] engines not configured, skipped: ${skipped.join(', ')}`)

  const normalizedDomain = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')

  const results: VisibilityRun[] = []
  for (const q of queries) {
    for (const [provider, ask, model] of legs) {
      try {
        const answer = await ask(q.query)
        // google_aio with no AI Overview at all: nothing to judge — skip the
        // row rather than record a mention=false that would drag the rate
        // down for a query Google doesn't AI-answer for ANYONE.
        if (answer.noAnswer) continue
        const judged = await judgeMention(answer.text, brandTerms, domain)
        // Native citations beat string-matching where the engine reports them.
        const citedDomains = answer.citedDomains ?? null
        const domainCited = citedDomains
          ? citedDomains.some(d => d === normalizedDomain) || judged.domainCited
          : judged.domainCited
        const row = {
          client_id: clientId,
          query_id: q.id,
          provider,
          model,
          mentioned: judged.mentioned || domainCited,
          domain_cited: domainCited,
          snippet: judged.snippet || null,
        }
        // cited_domains predates migrate_2026-08-25c on some environments —
        // retry without it so runs aren't lost mid-rollout.
        let ins = await supabase.from('visibility_runs')
          .insert({ ...row, cited_domains: citedDomains }).select().single()
        if (ins.error && /cited_domains/.test(ins.error.message)) {
          ins = await supabase.from('visibility_runs').insert(row).select().single()
        }
        if (ins.error) { console.error('[visibility] failed to save run', ins.error.message); continue }
        results.push(runFromRow(ins.data as RunRow))
      } catch (err) {
        console.error(`[visibility] ${provider} check failed for query "${q.query}"`, err)
      }
    }
  }
  return results
}

export async function getRuns(clientId: string, days = 30): Promise<VisibilityRun[]> {
  const since = new Date()
  since.setDate(since.getDate() - days)
  const { data, error } = await supabase
    .from('visibility_runs')
    .select('*')
    .eq('client_id', clientId)
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
  if (error) { console.error('[visibility] failed to load runs', error.message); return [] }
  return (data as RunRow[]).map(runFromRow)
}

export interface VisibilityTrendPoint {
  date: string
  mentionRate: number // 0..1 across all runs that day
  total: number
}

export async function getVisibilityTrend(clientId: string, days = 30): Promise<VisibilityTrendPoint[]> {
  const runs = await getRuns(clientId, days)
  const byDay = new Map<string, { mentioned: number; total: number }>()
  for (const r of runs) {
    const day = r.createdAt.slice(0, 10)
    const bucket = byDay.get(day) ?? { mentioned: 0, total: 0 }
    bucket.total++
    if (r.mentioned) bucket.mentioned++
    byDay.set(day, bucket)
  }
  return Array.from(byDay.entries())
    .map(([date, b]) => ({ date, mentionRate: b.total > 0 ? b.mentioned / b.total : 0, total: b.total }))
    .sort((a, b) => a.date.localeCompare(b.date))
}
