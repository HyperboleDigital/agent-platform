import { supabase } from './supabase'
import { getClientById } from './clients'
import { tierForKey } from './tiers'
import { getCrawlHistory } from './dataforseo'
import { getBudgetStatus } from './scheduled-jobs'
import { computeSetupStatus } from './setup-status'

// "This month" panel (handoff #3 §3): one screen that answers "what did you do
// for me this month and what's next" for the client, and "what needs my
// attention" for Owen. AGGREGATES ONLY EXISTING DATA — job_runs, crawls,
// keyword ranks, visibility runs, change requests, posts, unanswered
// questions. No paid calls; safe to render on every page load.

export interface KeywordMove { keyword: string; from: number | null; to: number | null }

export interface AttentionItem {
  kind: 'fix_unverified' | 'content_due' | 'brief_ready' | 'setup_incomplete' | 'budget_exceeded'
  label: string
  // Client-dashboard section the fix lives in ('' = client home).
  section: string
}

export interface MonthSummary {
  period: { start: string; end: string }
  siteHealth: {
    score: number | null       // latest finished crawl score (in or before the month)
    delta: number | null       // vs the previous finished crawl
    issuesFixed: number        // VERIFIED seo_fix requests this month — never bare 'done'
    issuesOpen: number
  }
  keywords: {
    tracked: number
    movedUp: KeywordMove[]
    movedDown: KeywordMove[]
    newTop10: KeywordMove[]
  }
  visibility: {
    mentionRate: number | null // 0..1 across the month's runs; null = no runs
    delta: number | null       // vs previous month
    byProvider: Record<string, { mentionRate: number; runs: number }>
    newlyCited: string[]       // query texts first mentioned this month
    citedInstead: { domain: string; count: number }[] // who IS cited where we aren't
  }
  content: {
    published: { title: string; slug: string | null; keyword: string }[]
    inReview: { title: string; keyword: string }[]
    quotaUsed: number
    quotaCap: number
  }
  unansweredQuestions: { question: string; count: number; lastAsked: string }[]
  requestsClosed: number
  // Superadmin only — stripped from the client response by the route.
  attention: AttentionItem[]
}

function monthBounds(month?: string): { start: Date; end: Date; prevStart: Date } {
  const m = /^\d{4}-\d{2}$/.test(month ?? '') ? month! : new Date().toISOString().slice(0, 7)
  const [y, mo] = m.split('-').map(Number)
  return {
    start: new Date(Date.UTC(y, mo - 1, 1)),
    end: new Date(Date.UTC(y, mo, 1)), // exclusive
    prevStart: new Date(Date.UTC(y, mo - 2, 1)),
  }
}

// Tolerates a table that predates its migration (returns []) so the panel
// renders gracefully mid-rollout instead of 500ing the whole summary.
async function safeRows<T>(q: PromiseLike<{ data: T[] | null; error: { message: string } | null }>, label: string): Promise<T[]> {
  const { data, error } = await q
  if (error) {
    console.warn(`[month-summary] ${label}: ${error.message}`)
    return []
  }
  return data ?? []
}

export async function buildMonthSummary(clientId: string, month?: string): Promise<MonthSummary> {
  const { start, end, prevStart } = monthBounds(month)
  const startIso = start.toISOString()
  const endIso = end.toISOString()
  const client = await getClientById(clientId)
  if (!client) throw new Error('Client not found')

  const [crawls, rankRows, visRows, prevVisRows, queryRows, requestRows, postRows, unansweredRows, keywordRows] = await Promise.all([
    getCrawlHistory(clientId), // finished, oldest→newest
    safeRows<any>(supabase.from('seo_keyword_ranks').select('keyword_id, keyword, rank_absolute, checked_at')
      .eq('client_id', clientId).gte('checked_at', startIso).lt('checked_at', endIso).order('checked_at', { ascending: true }), 'keyword ranks'),
    // cited_domains predates migrate_2026-08-25c on some environments — fall
    // back to the pre-migration column set rather than losing the section.
    supabase.from('visibility_runs').select('provider, mentioned, query_id, cited_domains, created_at')
      .eq('client_id', clientId).gte('created_at', startIso).lt('created_at', endIso)
      .then(res => res.error
        ? safeRows<any>(supabase.from('visibility_runs').select('provider, mentioned, query_id, created_at')
            .eq('client_id', clientId).gte('created_at', startIso).lt('created_at', endIso), 'visibility runs')
        : (res.data ?? [])),
    safeRows<any>(supabase.from('visibility_runs').select('provider, mentioned, query_id')
      .eq('client_id', clientId).gte('created_at', prevStart.toISOString()).lt('created_at', startIso), 'prev visibility runs'),
    safeRows<any>(supabase.from('visibility_queries').select('id, query').eq('client_id', clientId), 'visibility queries'),
    safeRows<any>(supabase.from('change_requests').select('id, status, source, completed_at, verified_at, regressed_at')
      .eq('client_id', clientId), 'change requests'),
    safeRows<any>(supabase.from('blog_posts').select('title, slug, target_keyword, status, published_at')
      .eq('client_id', clientId), 'posts'),
    safeRows<any>(supabase.from('chat_unanswered_questions').select('question, count, last_seen')
      .eq('client_id', clientId).eq('status', 'open').order('count', { ascending: false }).limit(8), 'unanswered questions'),
    safeRows<any>(supabase.from('seo_target_keywords').select('id').eq('client_id', clientId), 'target keywords'),
  ])

  // ── Site health ────────────────────────────────────────────────────────────
  const upTo = crawls.filter(c => new Date(c.createdAt) < end)
  const latest = upTo[upTo.length - 1] ?? null
  const previous = upTo[upTo.length - 2] ?? null
  const inMonth = (iso: string | null) => !!iso && iso >= startIso && iso < endIso
  const issuesFixed = requestRows.filter(r => r.source === 'seo_fix' && inMonth(r.verified_at)).length
  const siteHealth = {
    score: latest?.onpageScore ?? null,
    delta: latest?.onpageScore != null && previous?.onpageScore != null
      ? Math.round((latest.onpageScore - previous.onpageScore) * 10) / 10
      : null,
    issuesFixed,
    issuesOpen: latest?.issues?.length ?? 0,
  }

  // ── Keywords: first vs last check in the month, per tracked keyword ────────
  const trackedIds = new Set(keywordRows.map(k => k.id))
  const byKeyword = new Map<string, { keyword: string; first: number | null; last: number | null }>()
  for (const r of rankRows) {
    if (!trackedIds.has(r.keyword_id)) continue // deleted keywords drop out
    const entry = byKeyword.get(r.keyword_id)
    if (!entry) byKeyword.set(r.keyword_id, { keyword: r.keyword, first: r.rank_absolute, last: r.rank_absolute })
    else entry.last = r.rank_absolute
  }
  const movedUp: KeywordMove[] = []
  const movedDown: KeywordMove[] = []
  const newTop10: KeywordMove[] = []
  for (const { keyword, first, last } of byKeyword.values()) {
    const move = { keyword, from: first, to: last }
    // Lower rank number = better. null = not in the top 100 — worse than any number.
    const firstVal = first ?? 101
    const lastVal = last ?? 101
    if (lastVal < firstVal) movedUp.push(move)
    else if (lastVal > firstVal) movedDown.push(move)
    if (lastVal <= 10 && firstVal > 10) newTop10.push(move)
  }
  movedUp.sort((a, b) => ((a.to ?? 101) - (a.from ?? 101)) - ((b.to ?? 101) - (b.from ?? 101)))
  movedDown.sort((a, b) => ((b.to ?? 101) - (b.from ?? 101)) - ((a.to ?? 101) - (a.from ?? 101)))

  // ── Visibility ─────────────────────────────────────────────────────────────
  const rate = (rows: any[]) => rows.length ? rows.filter(r => r.mentioned).length / rows.length : null
  const mentionRate = rate(visRows)
  const prevRate = rate(prevVisRows)
  const byProvider: Record<string, { mentionRate: number; runs: number }> = {}
  for (const r of visRows) {
    const p = byProvider[r.provider] ?? { mentionRate: 0, runs: 0 }
    p.runs++
    if (r.mentioned) p.mentionRate++
    byProvider[r.provider] = p
  }
  for (const p of Object.values(byProvider)) p.mentionRate = p.runs ? p.mentionRate / p.runs : 0
  const queryText = new Map(queryRows.map(q => [q.id, q.query]))
  const mentionedNow = new Set(visRows.filter(r => r.mentioned).map(r => r.query_id))
  const mentionedBefore = new Set(prevVisRows.filter(r => r.mentioned).map(r => r.query_id))
  const newlyCited = [...mentionedNow].filter(id => !mentionedBefore.has(id))
    .map(id => queryText.get(id)).filter((q): q is string => !!q)
  // Who's getting cited instead: cited_domains on runs where we weren't mentioned.
  const domainCounts = new Map<string, number>()
  const ownDomain = (client.domain ?? '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')
  for (const r of visRows) {
    if (r.mentioned || !Array.isArray(r.cited_domains)) continue
    for (const d of r.cited_domains as string[]) {
      const clean = d.toLowerCase().replace(/^www\./, '')
      if (clean && clean !== ownDomain) domainCounts.set(clean, (domainCounts.get(clean) ?? 0) + 1)
    }
  }
  const citedInstead = [...domainCounts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  // ── Content + quota ────────────────────────────────────────────────────────
  const tier = tierForKey(client.tierKey)
  const published = postRows.filter(p => p.status === 'published' && inMonth(p.published_at))
  const content = {
    published: published.map(p => ({ title: p.title ?? '(untitled)', slug: p.slug ?? null, keyword: p.target_keyword })),
    inReview: postRows.filter(p => p.status === 'in_review')
      .map(p => ({ title: p.title ?? '(untitled)', keyword: p.target_keyword })),
    quotaUsed: published.length,
    quotaCap: tier?.quotas.contentPiecesPerMonth ?? 0,
  }

  // ── Requests / unanswered ──────────────────────────────────────────────────
  const requestsClosed = requestRows.filter(r => r.status === 'done' && inMonth(r.completed_at)).length
  const unansweredQuestions = unansweredRows.map(r => ({ question: r.question, count: r.count, lastAsked: r.last_seen }))

  // ── Attention (superadmin task list) ───────────────────────────────────────
  const attention: AttentionItem[] = []
  const regressed = requestRows.filter(r => r.source === 'seo_fix' && r.regressed_at != null).length
  if (regressed > 0) attention.push({ kind: 'fix_unverified', label: `${regressed} shipped fix(es) regressed — still flagged by the latest crawl`, section: 'requests' })
  const openBriefs = await safeRows<any>(supabase.from('content_briefs').select('id').eq('client_id', clientId).eq('status', 'open'), 'briefs')
  if (openBriefs.length > 0) attention.push({ kind: 'brief_ready', label: `${openBriefs.length} content brief(s) waiting to be drafted`, section: 'content' })
  if (content.quotaCap > 0 && content.quotaUsed < content.quotaCap) {
    attention.push({ kind: 'content_due', label: `Content quota: ${content.quotaUsed} of ${content.quotaCap} published this month`, section: 'content' })
  }
  try {
    const setup = await computeSetupStatus(clientId)
    if (!setup.complete) attention.push({ kind: 'setup_incomplete', label: `Setup incomplete — ${setup.incompleteCount} item(s) left`, section: 'seo' })
  } catch (err) {
    console.warn('[month-summary] setup status failed:', err instanceof Error ? err.message : err)
  }
  const budget = await getBudgetStatus(clientId)
  if (budget.overBudget) attention.push({ kind: 'budget_exceeded', label: `Job budget reached ($${(budget.spentCents / 100).toFixed(2)} of $${(budget.budgetCents / 100).toFixed(2)}) — paid jobs paused`, section: 'seo' })

  return {
    period: { start: startIso.slice(0, 10), end: new Date(end.getTime() - 86400000).toISOString().slice(0, 10) },
    siteHealth,
    keywords: { tracked: keywordRows.length, movedUp, movedDown, newTop10 },
    visibility: { mentionRate, delta: mentionRate != null && prevRate != null ? mentionRate - prevRate : null, byProvider, newlyCited, citedInstead },
    content,
    unansweredQuestions,
    requestsClosed,
    attention,
  }
}
