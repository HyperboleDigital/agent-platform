import { supabase } from './supabase'
import { getClientById } from './clients'
import { searchDocs } from '../tools/knowledge-base'
import { complete } from './llm/complete'
import type { Client } from '@agent-platform/shared'
import { tierForKey } from './tiers'
import { onPostPublished } from './content-briefs'

// Blog content engine (the `content` add-on service). One strong-model call
// produces a structured draft; mechanical validation + one repair pass keep
// the output contract honest; the human review step (draft -> in_review ->
// approved) is the actual quality gate — validation here exists to guarantee
// STRUCTURE, not to judge prose.

// ── Status machine ────────────────────────────────────────────────────────────

export type PostStatus = 'draft' | 'in_review' | 'approved' | 'published' | 'archived'

// Allowed transitions. `published` is only reachable from `approved`, and the
// publish/export route is what requests it — a post can't skip review.
const TRANSITIONS: Record<PostStatus, PostStatus[]> = {
  draft: ['in_review', 'archived'],
  in_review: ['approved', 'draft', 'archived'],
  approved: ['published', 'draft', 'archived'],
  published: ['archived'],
  archived: ['draft']
}

export function canTransition(from: PostStatus, to: PostStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BlogPost {
  id: string
  clientId: string
  brief: string
  targetKeyword: string
  title: string | null
  slug: string | null
  metaDescription: string | null
  contentMd: string | null
  status: PostStatus
  model: string | null
  framerItemId: string | null
  createdAt: string
  updatedAt: string
  publishedAt: string | null
}

interface Row {
  id: string
  client_id: string
  brief: string
  target_keyword: string
  title: string | null
  slug: string | null
  meta_description: string | null
  content_md: string | null
  status: PostStatus
  model: string | null
  framer_item_id: string | null
  created_at: string
  updated_at: string
  published_at: string | null
}

function fromRow(r: Row): BlogPost {
  return {
    id: r.id,
    clientId: r.client_id,
    brief: r.brief,
    targetKeyword: r.target_keyword,
    title: r.title,
    slug: r.slug,
    metaDescription: r.meta_description,
    contentMd: r.content_md,
    status: r.status,
    model: r.model,
    framerItemId: r.framer_item_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    publishedAt: r.published_at
  }
}

interface GeneratedDraft {
  title: string
  slug: string
  metaDescription: string
  bodyMd: string
  internalLinkSuggestions: Array<{ anchorText: string; url: string }>
}

// ── Prompt ────────────────────────────────────────────────────────────────────

// The writing rules are phrased as TESTABLE requirements wherever possible —
// "keyword in the first 100 words" beats "optimize for SEO" — because vague
// instructions are exactly what produces generic AI prose.
const WRITER_SYSTEM = `You are a senior content writer for a small service business. Your posts have to win twice: rank in Google, and get quoted by AI assistants (ChatGPT, Claude, AI Overviews) when people ask them questions.

VOICE
- Write for a customer with a problem, not for a marketer. 8th-grade reading level.
- Confident practitioner tone: plain sentences, concrete details, no hype.
- Specific beats clever. Every section must contain at least one number, example, step, or concrete scenario. If a paragraph could appear unchanged on a competitor's site, it is too generic — rewrite it.

GROUNDING — non-negotiable
- Facts about THIS business (services, prices, service area, guarantees, credentials, history) may come ONLY from the BUSINESS CONTEXT provided. If it isn't there, do not claim it.
- General industry knowledge is welcome and expected — that is what makes the post useful — but never dress it up as a claim about this specific business.
- Never invent testimonials, statistics with fake precision, or "studies show" without a real basis.

SEO MECHANICS
- Title: 50-60 characters, target keyword (or its core terms) near the front, states a benefit or answers a question. No colons followed by generic taglines.
- The exact target keyword phrase appears in the first 100 words of the body, and again naturally 2-4 more times across the post. If a sentence sounds like it was written for a robot, rewrite it — natural usage only.
- At least one H2 contains the keyword or a close variant.
- Meta description: 120-155 characters, contains the keyword, states the concrete benefit of reading, reads like a sentence a human wrote.
- Slug: short kebab-case from the keyword, no stop words, max 6 words.

STRUCTURE
- The body is markdown. NO H1 — the title is the H1. Use ## for sections and ### only inside the FAQ.
- Open with the reader's problem or a concrete fact in the first two sentences. Banned openers: rhetorical questions, "In today's...", any sentence that could precede any article on any topic.
- H2 headings must be informative on their own ("How much does a website redesign cost in 2026", not "Cost considerations").
- Paragraphs: 4 sentences max. When you enumerate more than two named items, format them as a markdown bullet list ("- **Item:** explanation"), NEVER as bold-led run-ons packed into one paragraph.
- End with a short, specific next step for the reader — not a summary, and never a heading called "Conclusion". When the business context supports it, the next step points at THIS business's obvious action (book a demo, request a quote, call) — this post lives on their own site, so "contact providers" phrasing is wrong.
- Total length: 900-1400 words.

FAQ — required
- Final section: "## Frequently asked questions" with 3-5 ### questions phrased the way people actually ask an assistant ("How long does...", "Do I need...", "What happens if...").
- Each answer is 2-4 sentences and fully self-contained — an AI assistant should be able to quote the answer alone and it still makes sense. This is what earns citations.

BANNED LANGUAGE
"delve", "unlock", "unleash", "elevate", "game-changer", "in today's fast-paced/digital world", "look no further", "we've got you covered", "seamless", "robust", "leverage" (as a verb), "Whether you're X or Y", "It's important to note", "In conclusion". If you reach for one of these, say the concrete thing instead.

INTERNAL LINKS
- If ALLOWED LINK PAGES are provided, suggest 1-3 internal links with natural anchor text, placed where they genuinely help the reader. Only URLs from that list — never invent URLs. If none fit, return an empty array.

OUTPUT
Return ONLY a JSON object, no markdown fences, exactly this shape:
{"title": string, "slug": string, "metaDescription": string, "bodyMd": string, "internalLinkSuggestions": [{"anchorText": string, "url": string}]}`

function buildUserPrompt(client: Client, brief: string, targetKeyword: string, context: string): string {
  const pages = client.portalConfig?.seoPages ?? []
  return [
    `BUSINESS: ${client.name}${client.industry ? ` — ${client.industry}` : ''}${client.domain ? ` (${client.domain})` : ''}`,
    ``,
    `TARGET KEYWORD: ${targetKeyword}`,
    ``,
    `BRIEF FROM THE OWNER: ${brief}`,
    ``,
    `BUSINESS CONTEXT (the only permitted source of business-specific facts):`,
    context.trim() || '(none provided — write the post on general industry knowledge only; make zero business-specific claims)',
    ``,
    `ALLOWED LINK PAGES:`,
    pages.length ? pages.map(p => `- ${p}`).join('\n') : '(none — return an empty internalLinkSuggestions array)',
    ``,
    `Write the post now. JSON only.`
  ].join('\n')
}

// ── Validation ────────────────────────────────────────────────────────────────

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length

// Structural failures abort (after one repair attempt); soft failures are
// repair targets but never block — the human reviewer is the final gate.
function validateDraft(d: GeneratedDraft, targetKeyword: string, allowedPages: string[]): { hard: string[]; soft: string[] } {
  const hard: string[] = []
  const soft: string[] = []
  const body = d.bodyMd ?? ''
  const kw = targetKeyword.toLowerCase()

  if (!d.title?.trim()) hard.push('title is missing')
  if (!d.metaDescription?.trim()) hard.push('metaDescription is missing')
  if (wordCount(body) < 500) hard.push(`body is too short (${wordCount(body)} words; need 900-1400)`)
  if (!/^##\s/m.test(body)) hard.push('body has no ## sections')
  if (!/^##\s+frequently asked questions/im.test(body)) hard.push('missing "## Frequently asked questions" section')
  if (/^#\s/m.test(body)) hard.push('body contains an H1 (# ) — the title is the H1; use ## sections')

  if (!body.toLowerCase().includes(kw)) soft.push(`the exact keyword phrase "${targetKeyword}" never appears in the body`)
  else if (!body.slice(0, 700).toLowerCase().includes(kw)) soft.push(`keyword "${targetKeyword}" is not in the first ~100 words`)
  if (d.metaDescription && (d.metaDescription.length < 70 || d.metaDescription.length > 160)) {
    soft.push(`metaDescription is ${d.metaDescription.length} chars (want 120-155)`)
  }
  if (d.title && d.title.length > 70) soft.push(`title is ${d.title.length} chars (want 50-60)`)
  if (wordCount(body) > 1800) soft.push(`body is long (${wordCount(body)} words; want 900-1400)`)
  const faqQuestions = (body.match(/^###\s/gm) ?? []).length
  if (faqQuestions < 3) soft.push(`FAQ has ${faqQuestions} questions (want 3-5)`)

  const banned = ['delve', 'unlock', 'game-changer', "in today's", 'look no further', 'in conclusion', 'robust', 'seamless', 'elevate', 'leverage', 'leveraging']
  const scannedText = `${d.title ?? ''}\n${d.metaDescription ?? ''}\n${body}`.toLowerCase()
  for (const phrase of banned) {
    if (scannedText.includes(phrase)) soft.push(`contains banned phrase "${phrase}"`)
  }

  // Links outside the allowed set are dropped silently rather than failed —
  // the model followed structure, we just refuse to propose invented URLs.
  d.internalLinkSuggestions = (d.internalLinkSuggestions ?? []).filter(l => allowedPages.includes(l.url))

  return { hard, soft }
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').split('-').slice(0, 6).join('-')
}

function parseDraft(raw: string): GeneratedDraft | null {
  const jsonText = raw.match(/\{[\s\S]*\}/)?.[0]
  if (!jsonText) return null
  try {
    const parsed = JSON.parse(jsonText)
    if (typeof parsed.title !== 'string' || typeof parsed.bodyMd !== 'string' || typeof parsed.metaDescription !== 'string') return null
    return {
      title: parsed.title,
      slug: typeof parsed.slug === 'string' && /^[a-z0-9-]+$/.test(parsed.slug) ? parsed.slug : slugify(parsed.title),
      metaDescription: parsed.metaDescription,
      bodyMd: parsed.bodyMd,
      internalLinkSuggestions: Array.isArray(parsed.internalLinkSuggestions)
        ? parsed.internalLinkSuggestions.filter((l: unknown): l is { anchorText: string; url: string } =>
            !!l && typeof (l as { anchorText?: unknown }).anchorText === 'string' && typeof (l as { url?: unknown }).url === 'string')
        : []
    }
  } catch {
    return null
  }
}

// ── Generation ────────────────────────────────────────────────────────────────

const CONTENT_MAX_TOKENS = 4000

export async function draftPost(clientId: string, brief: string, targetKeyword: string): Promise<BlogPost> {
  const client = await getClientById(clientId)
  if (!client) throw new Error('Client not found')
  if (!brief.trim()) throw new Error('A brief is required')
  if (!targetKeyword.trim()) throw new Error('A target keyword is required')

  // Ground in the client's own knowledge base: what they say about the topic,
  // and what they say about themselves. Failures degrade to ungrounded-but-
  // honest (the prompt then forbids business-specific claims entirely).
  const [topicContext, businessContext] = await Promise.all([
    searchDocs(targetKeyword, clientId).catch(() => ''),
    searchDocs(`${client.name} services about`, clientId).catch(() => '')
  ])
  const context = [topicContext, businessContext].filter(Boolean).join('\n\n---\n\n')

  const userPrompt = buildUserPrompt(client, brief, targetKeyword, context)
  const allowedPages = client.portalConfig?.seoPages ?? []

  let raw = await complete(userPrompt, { system: WRITER_SYSTEM, tier: 'strong', maxTokens: CONTENT_MAX_TOKENS })
  let draft = parseDraft(raw)
  let issues = draft ? validateDraft(draft, targetKeyword, allowedPages) : { hard: ['output was not valid JSON'], soft: [] }

  // One repair pass, fed the SPECIFIC failures — not a blind regeneration.
  if (!draft || issues.hard.length > 0 || issues.soft.length > 0) {
    const problems = [...issues.hard, ...issues.soft].map(p => `- ${p}`).join('\n')
    const repairPrompt = draft
      ? `${userPrompt}\n\nYour previous draft had these problems:\n${problems}\n\nPrevious draft JSON:\n${JSON.stringify(draft)}\n\nReturn the corrected FULL JSON object. Fix every listed problem; change nothing that was not flagged.`
      : `${userPrompt}\n\nYour previous response was not valid JSON. Return ONLY the JSON object this time.`
    raw = await complete(repairPrompt, { system: WRITER_SYSTEM, tier: 'strong', maxTokens: CONTENT_MAX_TOKENS })
    const repaired = parseDraft(raw)
    if (repaired) {
      const repairedIssues = validateDraft(repaired, targetKeyword, allowedPages)
      // Keep whichever attempt is structurally sound; prefer the repair.
      if (repairedIssues.hard.length === 0) {
        draft = repaired
        issues = repairedIssues
      }
    }
  }

  if (!draft || issues.hard.length > 0) {
    throw new Error(`Generation failed structural checks: ${issues.hard.join('; ') || 'invalid output'}`)
  }
  if (issues.soft.length > 0) {
    console.warn(`[content] draft for ${clientId} accepted with soft issues:`, issues.soft)
  }

  // Surface link suggestions to the reviewer inside the draft itself — the
  // reviewer decides placement; we don't silently rewrite the model's prose.
  const linksBlock = draft.internalLinkSuggestions.length
    ? `\n\n<!-- Suggested internal links (place while reviewing):\n${draft.internalLinkSuggestions.map(l => `  [${l.anchorText}](${l.url})`).join('\n')}\n-->`
    : ''

  const modelUsed = process.env.LLM_PROVIDER === 'openai'
    ? (process.env.OPENAI_CONTENT_MODEL ?? 'gpt-4o')
    : (process.env.ANTHROPIC_CONTENT_MODEL ?? 'claude-sonnet-5')

  const { data, error } = await supabase
    .from('blog_posts')
    .insert({
      client_id: clientId,
      brief,
      target_keyword: targetKeyword,
      title: draft.title,
      slug: draft.slug,
      meta_description: draft.metaDescription,
      content_md: draft.bodyMd + linksBlock,
      status: 'draft',
      model: modelUsed
    })
    .select()
    .single()
  if (error) throw error
  return fromRow(data as Row)
}

// ── CRUD + transitions ────────────────────────────────────────────────────────

export async function listPosts(clientId: string): Promise<BlogPost[]> {
  const { data, error } = await supabase
    .from('blog_posts')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
  if (error) { console.error('[content] list error', error.message); return [] }
  return (data as Row[]).map(fromRow)
}

export async function getPost(clientId: string, postId: string): Promise<BlogPost | null> {
  const { data } = await supabase.from('blog_posts').select('*').eq('client_id', clientId).eq('id', postId).maybeSingle()
  return data ? fromRow(data as Row) : null
}

// Content edits are only allowed pre-publish; published/archived posts are a
// record of what actually went out.
const EDITABLE_STATUSES: PostStatus[] = ['draft', 'in_review', 'approved']

export async function updatePost(
  clientId: string,
  postId: string,
  patch: Partial<Pick<BlogPost, 'title' | 'slug' | 'metaDescription' | 'contentMd' | 'brief' | 'targetKeyword'>>
): Promise<BlogPost> {
  const existing = await getPost(clientId, postId)
  if (!existing) throw new Error('Post not found')
  if (!EDITABLE_STATUSES.includes(existing.status)) throw new Error(`A ${existing.status} post cannot be edited`)

  const { data, error } = await supabase
    .from('blog_posts')
    .update({
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.slug != null ? { slug: slugify(patch.slug) } : {}),
      ...(patch.metaDescription !== undefined ? { meta_description: patch.metaDescription } : {}),
      ...(patch.contentMd !== undefined ? { content_md: patch.contentMd } : {}),
      ...(patch.brief !== undefined ? { brief: patch.brief } : {}),
      ...(patch.targetKeyword !== undefined ? { target_keyword: patch.targetKeyword } : {}),
      updated_at: new Date().toISOString()
    })
    .eq('client_id', clientId)
    .eq('id', postId)
    .select()
    .single()
  if (error) throw error
  return fromRow(data as Row)
}

// Published posts this calendar month — the content-quota denominator
// (handoff #3 §4c). Counts by published_at so re-publishing an old post after
// an edit doesn't double-count.
export async function publishedThisMonth(clientId: string): Promise<number> {
  const monthStart = new Date()
  monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0)
  const { count, error } = await supabase
    .from('blog_posts')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('status', 'published')
    .gte('published_at', monthStart.toISOString())
  if (error) { console.error('[content] publishedThisMonth failed:', error.message); return 0 }
  return count ?? 0
}

export async function transitionPost(clientId: string, postId: string, to: PostStatus, opts: { overrideQuota?: boolean } = {}): Promise<BlogPost> {
  const existing = await getPost(clientId, postId)
  if (!existing) throw new Error('Post not found')
  if (!canTransition(existing.status, to)) {
    throw new Error(`Cannot move a ${existing.status} post to ${to}`)
  }

  // Content quota (handoff #3 §4c): the tier's contentPiecesPerMonth is a
  // hard stop on publishing, with an explicit superadmin override. A tier
  // with quota 0 (or no tier) publishes only via override — those clients
  // aren't sold monthly content, so a publish is always a deliberate act.
  if (to === 'published' && !opts.overrideQuota) {
    const client = await getClientById(clientId)
    const cap = tierForKey(client?.tierKey)?.quotas.contentPiecesPerMonth ?? 0
    const used = await publishedThisMonth(clientId)
    if (used >= cap) {
      throw new Error(cap > 0
        ? `Monthly content quota reached (${used} of ${cap} published this month) — publishing more requires a superadmin override.`
        : 'This plan has no monthly content quota — publishing requires a superadmin override.')
    }
  }

  const { data, error } = await supabase
    .from('blog_posts')
    .update({
      status: to,
      updated_at: new Date().toISOString(),
      ...(to === 'published' ? { published_at: new Date().toISOString() } : {})
    })
    .eq('client_id', clientId)
    .eq('id', postId)
    .select()
    .single()
  if (error) throw error
  const post = fromRow(data as Row)
  // Close the questions→content loop: mark the source question answered and
  // feed the Q&A back to the chatbot KB. Best-effort by design.
  if (to === 'published') {
    void onPostPublished(clientId, postId, { title: post.title, contentMd: post.contentMd })
  }
  return post
}

// Records the Framer CMS item ID a post was published as, so a retry after a
// later failure (e.g. the status transition) updates the same item instead
// of creating a duplicate. Called before transitionPost(..., 'published').
export async function setFramerItemId(clientId: string, postId: string, framerItemId: string): Promise<void> {
  const { error } = await supabase
    .from('blog_posts')
    .update({ framer_item_id: framerItemId, updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .eq('id', postId)
  if (error) throw error
}
