import { supabase } from './supabase'
import { getClientById } from './clients'
import { checkOrganicRank } from './dataforseo'

// Target-keyword rank tracking — the strategic counterpart to the GSC
// "Rankings" view. GSC shows what a site already ranks for; this tracks the
// keywords a client is *trying* to rank for, their current Google organic
// position, and the trend over time. Checks are on-demand (no scheduler yet).

export interface TargetKeyword {
  id: string
  clientId: string
  keyword: string
  createdAt: string
  // Latest recorded position (null = checked but not found, undefined = never checked)
  latestRank: number | null
  latestUrl: string | null
  latestCheckedAt: string | null
  // Oldest→newest position points, for the sparkline/trend.
  trend: { checkedAt: string; rank: number | null }[]
}

interface KeywordRow {
  id: string
  client_id: string
  keyword: string
  created_at: string
}

interface RankRow {
  id: string
  keyword_id: string
  client_id: string
  keyword: string
  rank_absolute: number | null
  url: string | null
  checked_at: string
}

export async function listTargetKeywords(clientId: string): Promise<TargetKeyword[]> {
  const [{ data: kwData }, { data: rankData }] = await Promise.all([
    supabase.from('seo_target_keywords').select('*').eq('client_id', clientId).order('created_at', { ascending: true }),
    supabase.from('seo_keyword_ranks').select('*').eq('client_id', clientId).order('checked_at', { ascending: true })
  ])
  const ranks = (rankData ?? []) as RankRow[]
  const byKeyword = new Map<string, RankRow[]>()
  for (const r of ranks) {
    const arr = byKeyword.get(r.keyword_id) ?? []
    arr.push(r)
    byKeyword.set(r.keyword_id, arr)
  }

  return ((kwData ?? []) as KeywordRow[]).map(k => {
    const history = byKeyword.get(k.id) ?? []
    const latest = history[history.length - 1]
    return {
      id: k.id,
      clientId: k.client_id,
      keyword: k.keyword,
      createdAt: k.created_at,
      latestRank: latest ? latest.rank_absolute : null,
      latestUrl: latest ? latest.url : null,
      latestCheckedAt: latest ? latest.checked_at : null,
      trend: history.map(h => ({ checkedAt: h.checked_at, rank: h.rank_absolute }))
    }
  })
}

export async function addTargetKeyword(clientId: string, keyword: string): Promise<void> {
  const trimmed = keyword.trim()
  if (!trimmed) throw new Error('Keyword is required')
  const { error } = await supabase
    .from('seo_target_keywords')
    .insert({ client_id: clientId, keyword: trimmed })
  // Unique violation = already tracking it; treat as a no-op rather than an error.
  if (error && error.code !== '23505') throw new Error(`Failed to add keyword: ${error.message}`)
}

export async function removeTargetKeyword(clientId: string, keywordId: string): Promise<void> {
  const { error } = await supabase
    .from('seo_target_keywords')
    .delete()
    .eq('client_id', clientId)
    .eq('id', keywordId)
  if (error) throw new Error(`Failed to remove keyword: ${error.message}`)
}

// Checks the current organic position for every tracked keyword and records a
// rank snapshot for each. Costs one DataForSEO SERP call per keyword (~$0.002),
// so it's an explicit action, never automatic.
export async function checkKeywordRanks(clientId: string): Promise<TargetKeyword[]> {
  const client = await getClientById(clientId)
  if (!client) throw new Error('Client not found')
  if (!client.domain) throw new Error('Client has no website domain set — needed to find its position')

  const { data } = await supabase.from('seo_target_keywords').select('*').eq('client_id', clientId)
  const keywords = (data ?? []) as KeywordRow[]

  for (const k of keywords) {
    try {
      const result = await checkOrganicRank(k.keyword, client.domain)
      await supabase.from('seo_keyword_ranks').insert({
        keyword_id: k.id,
        client_id: clientId,
        keyword: k.keyword,
        rank_absolute: result.rankAbsolute,
        url: result.url
      })
    } catch (err) {
      console.error(`[seo-keywords] rank check failed for "${k.keyword}"`, err instanceof Error ? err.message : err)
    }
  }

  return listTargetKeywords(clientId)
}
