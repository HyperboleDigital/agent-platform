import { supabase } from './supabase'
import { getClientById } from './clients'
import { tierForKey } from './tiers'
import { complete } from './llm/complete'
import { getUnanswered } from './analytics'
import { listTargetKeywords } from './seo-keywords'
import { addDocument } from '../tools/knowledge-base'

// Chatbot questions → content briefs (handoff #3 §4b): the GEO differentiator.
// Real customer questions the chat assistant couldn't answer become monthly
// content BRIEFS (title + keyword + question + outline + internal links) —
// not drafts; "Draft this" hands a brief into the existing lib/content.ts
// draft → review → publish flow. When the post publishes, the question is
// marked answered and its Q&A is fed back into the chatbot knowledge base so
// the assistant answers it next time.

// ── Unanswered-question capture ──────────────────────────────────────────────

export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 300)
}

// Upsert one unanswered question — called from the orchestrator's
// low-confidence fallback path. Best-effort: a failure (e.g. table not yet
// migrated) logs and never breaks the chat reply.
export async function recordUnansweredQuestion(clientId: string, question: string): Promise<void> {
  const trimmed = question.trim().slice(0, 500)
  const normalized = normalizeQuestion(trimmed)
  if (!normalized) return
  try {
    const { data: existing } = await supabase
      .from('chat_unanswered_questions')
      .select('id, count')
      .eq('client_id', clientId)
      .eq('normalized', normalized)
      .maybeSingle()
    if (existing) {
      await supabase.from('chat_unanswered_questions')
        .update({ count: existing.count + 1, last_seen: new Date().toISOString() })
        .eq('id', existing.id)
    } else {
      const { error } = await supabase.from('chat_unanswered_questions')
        .insert({ client_id: clientId, question: trimmed, normalized })
      // 23505 = a concurrent insert won the race; that occurrence is counted.
      if (error && error.code !== '23505') throw error
    }
  } catch (err) {
    console.warn('[content-briefs] failed to record unanswered question:', err instanceof Error ? err.message : err)
  }
}

// One-time-ish seed from history: the low-confidence entries already sitting
// in message_logs, rolled up into rows. Runs at the start of the content_brief
// job so a client whose bot has been live for months doesn't start from zero.
// Idempotent via the (client_id, normalized) unique index.
export async function seedUnansweredFromHistory(clientId: string, days = 90): Promise<number> {
  const to = new Date()
  const from = new Date(to.getTime() - days * 86400000)
  const entries = await getUnanswered(clientId, { from, to }, 200).catch(() => [])
  let seeded = 0
  const seen = new Set<string>()
  for (const e of entries) {
    const normalized = normalizeQuestion(e.question ?? '')
    if (!normalized || normalized.split(' ').length < 3 || seen.has(normalized)) continue
    seen.add(normalized)
    const { error } = await supabase.from('chat_unanswered_questions')
      .insert({ client_id: clientId, question: e.question.trim().slice(0, 500), normalized, first_seen: e.createdAt, last_seen: e.createdAt })
    if (!error) seeded++
    else if (error.code !== '23505') {
      console.warn('[content-briefs] seed insert failed:', error.message)
      break // table probably missing — don't spin through 200 failures
    }
  }
  return seeded
}

// ── Briefs ───────────────────────────────────────────────────────────────────

export interface ContentBrief {
  id: string
  clientId: string
  questionId: string | null
  title: string
  targetKeyword: string
  question: string | null
  outline: string[]
  internalLinks: string[]
  status: 'open' | 'drafted' | 'archived'
  postId: string | null
  createdAt: string
}

function briefFromRow(r: any): ContentBrief {
  return {
    id: r.id,
    clientId: r.client_id,
    questionId: r.question_id,
    title: r.title,
    targetKeyword: r.target_keyword,
    question: r.question,
    outline: Array.isArray(r.outline) ? r.outline : [],
    internalLinks: r.internal_links ?? [],
    status: r.status,
    postId: r.post_id,
    createdAt: r.created_at,
  }
}

export async function listBriefs(clientId: string): Promise<ContentBrief[]> {
  const { data, error } = await supabase
    .from('content_briefs').select('*').eq('client_id', clientId)
    .order('created_at', { ascending: false }).limit(50)
  if (error) { console.warn('[content-briefs] list failed:', error.message); return [] }
  return (data ?? []).map(briefFromRow)
}

interface BriefSource {
  kind: 'question' | 'keyword'
  questionId?: string
  question?: string
  keyword?: string
}

// Generates this month's briefs: top-N open unanswered questions
// (N = tier contentPiecesPerMonth, min 1) + up to 2 unranked target keywords.
// Cheap-model (Haiku). Idempotent per calendar month: sources that already
// have a brief this month are skipped.
export async function generateBriefs(clientId: string): Promise<{ created: number; skipped: number }> {
  const client = await getClientById(clientId)
  if (!client) throw new Error('Client not found')
  const tier = tierForKey(client.tierKey)
  const n = Math.max(1, tier?.quotas.contentPiecesPerMonth ?? 0)

  await seedUnansweredFromHistory(clientId)

  const monthStart = new Date()
  monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0)
  const { data: monthBriefs, error: mbErr } = await supabase
    .from('content_briefs').select('question_id, target_keyword')
    .eq('client_id', clientId).gte('created_at', monthStart.toISOString())
  if (mbErr) throw new Error(`generateBriefs: ${mbErr.message} (run migrate_2026-08-25c_geo-content.sql?)`)
  const briefedQuestionIds = new Set((monthBriefs ?? []).map(b => b.question_id).filter(Boolean))
  const briefedKeywords = new Set((monthBriefs ?? []).map(b => b.target_keyword))

  const { data: openQuestions } = await supabase
    .from('chat_unanswered_questions').select('id, question')
    .eq('client_id', clientId).eq('status', 'open')
    .order('count', { ascending: false }).order('last_seen', { ascending: false })
    .limit(n * 2)

  const sources: BriefSource[] = []
  for (const q of openQuestions ?? []) {
    if (sources.length >= n) break
    if (briefedQuestionIds.has(q.id)) continue
    sources.push({ kind: 'question', questionId: q.id, question: q.question })
  }
  // Top up with unranked target keywords (tracked but not in Google's top 100).
  const keywords = await listTargetKeywords(clientId)
  for (const k of keywords.filter(k => k.latestCheckedAt && k.latestRank === null)) {
    if (sources.length >= n + 2) break
    if (briefedKeywords.has(k.keyword)) continue
    sources.push({ kind: 'keyword', keyword: k.keyword })
  }

  if (sources.length === 0) return { created: 0, skipped: 0 }

  const pages = client.portalConfig?.seoPages?.length
    ? client.portalConfig.seoPages
    : client.domain ? [client.domain.startsWith('http') ? client.domain : `https://${client.domain}`] : []

  let created = 0, skipped = 0
  for (const src of sources) {
    const subject = src.kind === 'question'
      ? `the real customer question: "${src.question}"`
      : `the target keyword "${src.keyword}" (tracked but not yet ranking)`
    const prompt = `You are planning ONE piece of website content for ${client.name}${client.industry ? ` (${client.industry})` : ''}.
It must answer ${subject}.

Existing site pages available for internal links:
${pages.map(p => `- ${p}`).join('\n') || '(none listed)'}

Return ONLY strict JSON:
{"title": "compelling, specific page title (<= 65 chars)", "targetKeyword": "the search phrase this page should rank for", "outline": ["4-7 H2 section headings, specific not generic"], "internalLinks": ["existing page URLs from the list above worth linking to (subset only, [] if none fit)"]}
Ground everything in the business context given — do not invent services or claims.`
    try {
      const raw = await complete(prompt, { maxTokens: 500, tier: 'cheap' })
      const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '')
      if (!parsed.title || !parsed.targetKeyword) { skipped++; continue }
      const { error } = await supabase.from('content_briefs').insert({
        client_id: clientId,
        question_id: src.questionId ?? null,
        title: String(parsed.title).slice(0, 200),
        target_keyword: String(parsed.targetKeyword).slice(0, 120),
        question: src.question ?? null,
        outline: Array.isArray(parsed.outline) ? parsed.outline.slice(0, 8).map(String) : [],
        internal_links: Array.isArray(parsed.internalLinks) ? parsed.internalLinks.slice(0, 6).map(String).filter((u: string) => pages.includes(u)) : [],
      })
      if (error) { console.error('[content-briefs] insert failed:', error.message); skipped++; continue }
      if (src.questionId) {
        await supabase.from('chat_unanswered_questions').update({ status: 'briefed' }).eq('id', src.questionId)
      }
      created++
    } catch (err) {
      console.error('[content-briefs] generation failed:', err instanceof Error ? err.message : err)
      skipped++
    }
  }
  return { created, skipped }
}

// "Draft this": hand a brief to the lib/content.ts draft flow and link the
// resulting post back so publish can close the loop.
export function briefToPrompt(brief: ContentBrief): string {
  const lines = [brief.title]
  if (brief.question) lines.push(`This page must directly answer the real customer question: "${brief.question}"`)
  if (brief.outline.length) lines.push(`Suggested outline:\n${brief.outline.map(h => `- ${h}`).join('\n')}`)
  if (brief.internalLinks.length) lines.push(`Link to: ${brief.internalLinks.join(', ')}`)
  return lines.join('\n\n')
}

export async function markBriefDrafted(clientId: string, briefId: string, postId: string): Promise<void> {
  const { error } = await supabase.from('content_briefs')
    .update({ status: 'drafted', post_id: postId })
    .eq('client_id', clientId).eq('id', briefId)
  if (error) throw new Error(`markBriefDrafted: ${error.message}`)
}

// Close the loop on publish: mark the source question answered and feed the
// Q&A into the chatbot knowledge base so the assistant answers it next time.
// Called from the publish transition; best-effort (a KB hiccup must not fail
// the publish).
export async function onPostPublished(clientId: string, postId: string, post: { title: string | null; contentMd: string | null }): Promise<void> {
  try {
    const { data: brief } = await supabase
      .from('content_briefs').select('id, question_id, question')
      .eq('client_id', clientId).eq('post_id', postId).maybeSingle()
    if (!brief) return
    if (brief.question_id) {
      await supabase.from('chat_unanswered_questions').update({ status: 'answered' }).eq('id', brief.question_id)
    }
    if (brief.question && post.contentMd) {
      await addDocument(
        clientId,
        `Q&A: ${brief.question}`.slice(0, 200),
        `Question customers ask: ${brief.question}\n\nAnswer (from our published page "${post.title ?? ''}"):\n\n${post.contentMd.slice(0, 6000)}`,
        { description: 'Auto-added when the answering blog post was published' }
      )
    }
  } catch (err) {
    console.warn('[content-briefs] publish follow-up failed:', err instanceof Error ? err.message : err)
  }
}
