import { supabase } from './supabase'
import { discoverBusinesses, type DiscoveryOptions, type DiscoveryResult, type ProspectCandidate } from './places'
import { complete, type UsageSink } from './llm/complete'
import { listPreviews, previewUrl } from './prospect-previews'

// Cold-outreach prospecting engine (v1: discovery + drafts). Admin/superadmin
// tool: find local businesses via Google Places, draft a personalized outreach
// email for each, and hand the operator a list they send THEMSELVES from their
// own inbox. The platform never sends email here — there is no send path, no
// scheduler, nothing automatic. Mirrors the lib+CRUD+on-demand-action shape of
// seo-keywords.ts.

export type ProspectStatus =
  | 'new' | 'saved' | 'drafted' | 'sent' | 'replied' | 'won' | 'lost' | 'do_not_contact'

export interface Prospect {
  id: string
  placeId: string | null
  name: string
  category: string | null
  groupName: string | null
  area: string | null
  phone: string | null
  email: string | null
  website: string | null
  noWebsite: boolean
  mapsUrl: string | null
  rating: number | null
  reviewCount: number | null
  status: ProspectStatus
  draftPlain: string | null
  draftLoom: string | null
  draftValue: string | null
  hookSource: string | null
  notes: string | null
  createdAt: string
}

interface ProspectRow {
  id: string
  place_id: string | null
  name: string
  category: string | null
  group_name: string | null
  area: string | null
  phone: string | null
  email: string | null
  website: string | null
  maps_url: string | null
  rating: number | null
  review_count: number | null
  status: string
  draft_plain: string | null
  draft_loom: string | null
  draft_value: string | null
  hook_source: string | null
  notes: string | null
  created_at: string
}

function fromRow(r: ProspectRow): Prospect {
  return {
    id: r.id,
    placeId: r.place_id,
    name: r.name,
    category: r.category,
    groupName: r.group_name,
    area: r.area,
    phone: r.phone,
    email: r.email,
    website: r.website,
    noWebsite: !r.website,
    mapsUrl: r.maps_url,
    rating: r.rating,
    reviewCount: r.review_count,
    status: r.status as ProspectStatus,
    draftPlain: r.draft_plain,
    draftLoom: r.draft_loom,
    draftValue: r.draft_value,
    hookSource: r.hook_source,
    notes: r.notes,
    createdAt: r.created_at,
  }
}

// ── Discovery ─────────────────────────────────────────────────────────────────
// Live Places lookup — returns candidates NOT yet persisted, so the operator can
// review before saving the good ones.
export async function discoverProspects(opts: DiscoveryOptions & { forceRefresh?: boolean }): Promise<DiscoveryResult> {
  return discoverBusinesses(opts)
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

// The group a newly-saved prospect lands in when the caller doesn't name one:
// the search category, title-cased ("roofer" → "Roofer"). Only a starting
// label — group_name is editable and renaming it never touches `category`.
export function defaultGroupName(category: string): string {
  const trimmed = category.trim()
  if (!trimmed) return 'Ungrouped'
  return trimmed.replace(/\b\w/g, c => c.toUpperCase())
}

export interface ProspectFilter {
  status?: ProspectStatus
  group?: string   // exact group_name; UNGROUPED_KEY selects rows with none
}

// Sentinel for "has no group" in a query string, where null can't be expressed.
export const UNGROUPED_KEY = '__ungrouped__'

export async function listProspects(filter: ProspectFilter = {}): Promise<Prospect[]> {
  let query = supabase.from('prospects').select('*').order('created_at', { ascending: false })
  if (filter.status) query = query.eq('status', filter.status)
  if (filter.group === UNGROUPED_KEY) query = query.is('group_name', null)
  else if (filter.group) query = query.eq('group_name', filter.group)
  const { data, error } = await query
  if (error) throw new Error(`Failed to list prospects: ${error.message}`)
  return ((data ?? []) as ProspectRow[]).map(fromRow)
}

// Rename a group across every prospect in it. Returns how many moved, so the
// dashboard can confirm the rename actually hit the rows it expected.
export async function renameProspectGroup(from: string, to: string): Promise<number> {
  const target = to.trim()
  if (!target) throw new Error('New group name is required')
  const { data, error } = await supabase
    .from('prospects')
    .update({ group_name: target })
    .eq('group_name', from)
    .select('id')
  if (error) throw new Error(`Failed to rename group: ${error.message}`)
  return (data ?? []).length
}

export async function getProspect(id: string): Promise<Prospect | null> {
  const { data, error } = await supabase.from('prospects').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`Failed to load prospect: ${error.message}`)
  return data ? fromRow(data as ProspectRow) : null
}

// Save a discovered candidate. Upsert on place_id so the same business found
// across repeated searches collapses to one row (23505 unique-violation no-op,
// same pattern as addTargetKeyword).
export interface SaveContext {
  category: string
  area: string
  groupName?: string   // omitted → defaultGroupName(category)
}

function toRowInsert(candidate: ProspectCandidate, context: SaveContext) {
  return {
    place_id: candidate.placeId,
    name: candidate.name,
    category: context.category,
    group_name: context.groupName?.trim() || defaultGroupName(context.category),
    area: context.area,
    phone: candidate.phone,
    website: candidate.website,
    maps_url: candidate.mapsUrl,
    rating: candidate.rating,
    review_count: candidate.reviewCount,
    status: 'saved',
  }
}

export async function saveProspect(
  candidate: ProspectCandidate,
  context: SaveContext
): Promise<Prospect> {
  const { data, error } = await supabase
    .from('prospects')
    .upsert(toRowInsert(candidate, context), { onConflict: 'place_id' })
    .select()
    .single()
  if (error) throw new Error(`Failed to save prospect: ${error.message}`)
  return fromRow(data as ProspectRow)
}

// Save a whole selection in one round trip. Same place_id upsert as the single
// save, so re-saving a business the operator already has is a harmless no-op
// rather than a duplicate row — which is what makes "select all → save" safe
// to hit repeatedly across overlapping searches.
export async function saveProspects(
  candidates: ProspectCandidate[],
  context: SaveContext
): Promise<Prospect[]> {
  if (!candidates.length) return []
  const { data, error } = await supabase
    .from('prospects')
    .upsert(candidates.map(c => toRowInsert(c, context)), { onConflict: 'place_id' })
    .select()
  if (error) throw new Error(`Failed to save prospects: ${error.message}`)
  return ((data ?? []) as ProspectRow[]).map(fromRow)
}

export async function updateProspect(
  id: string,
  patch: { status?: ProspectStatus; email?: string | null; notes?: string | null; group_name?: string | null }
): Promise<Prospect> {
  const { data, error } = await supabase
    .from('prospects')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(`Failed to update prospect: ${error.message}`)
  return fromRow(data as ProspectRow)
}

// Hard delete. prospect_mockups and prospect_previews both reference
// prospect_id with ON DELETE CASCADE, so removing a prospect removes its
// generated concepts and share links with it — there's no separate cleanup
// step and no "undo" here, only re-discovering and re-saving.
export async function deleteProspect(id: string): Promise<void> {
  const { error } = await supabase.from('prospects').delete().eq('id', id)
  if (error) throw new Error(`Failed to delete prospect: ${error.message}`)
}

// ── Draft generation ──────────────────────────────────────────────────────────
// One LLM call returns BOTH variants (plain + Loom) so the operator can A/B test
// with/without a video. The personalization hook is a light homepage fetch for
// has-website prospects, or the "you don't have a site, we build them" angle for
// no-website ones (the prime targets). Deep SEO audits stay a separate action.

// Rewritten after a real generated draft came back as pure agency boilerplate
// ("Enhancing Tampa Roof Repair's Online Presence" / "we specialize in helping
// local service businesses enhance their online visibility"). The old prompt
// said "NOT salesy or templated" and nothing else — a negative instruction
// with no concrete alternative, which the model satisfies on its own terms
// while still reaching for the marketing register it saw most in training.
// Banned phrases and a hard structure work where "don't be salesy" does not.
const DRAFT_SYSTEM = `You write cold outreach for Owen, who runs Hyperbole Digital — a very small web/SEO shop
working with local service businesses (roofers, med spas, contractors). You are writing ONE person to ONE
person. The reader is a busy owner or office manager who gets several agency pitches a week and deletes
all of them in under two seconds.

THE TEST every line must pass: could this sentence be sent, unchanged, to a different business in a
different industry? If yes, it is filler — cut it or replace it with something only true of THIS business.

LENGTH: 60-110 words in the body. Shorter beats longer. Most cold emails die from length alone.

SUBJECT LINE: 2-5 words. Lowercase or sentence case, never Title Case — Title Case reads as a marketing
blast. It should look like a note from someone who already knows them. Name the specific thing, e.g.
"your roof repair page", "quick question about your site", "tampa roof repair site". Never a benefit
claim, never a pitch, never a colon-separated headline.

BANNED — these are the exact phrases that make a cold email read as spam. Do not use them or close
variants: "I hope this email finds you well", "reaching out", "I wanted to reach out", "we specialize in",
"we help businesses like yours", "businesses like yours", "online presence", "digital presence", "digital goals", "take your
business to the next level", "elevate", "enhance", "optimize your", "leverage", "solutions", "in today's
digital landscape", "passionate about", "I came across your website and was impressed", "synergy",
"circle back", "touch base", "let me know if you'd be interested". Also never open with a dangling
participle of admiration ("Admiring your commitment to...").

STRUCTURE:
  1. FIRST LINE: one specific, verifiable observation about their business, drawn from what you were
     given. Not flattery — an observation. "You're one of the only roofers in Tampa listing tarp
     installs" is an observation. "Admiring your commitment to quality" is flattery. If you have nothing
     concrete, say something plainly true and small rather than inventing praise.
  2. THE REASON YOU'RE WRITING: state it in one sentence, plainly. No windup.
  3. WHAT YOU'RE OFFERING: concrete and specific to them. Never describe Hyperbole Digital's service
     menu. Never use the word "we" to describe capabilities — write what you did or noticed, not what
     the company specializes in.
  4. THE ASK: one line, low friction, answerable with a single word. "Want me to send it over?" or
     "Worth a look?" — not "book a 30-minute call to discuss your digital strategy". Asking for a reply
     beats asking for calendar time in a first email.

VOICE: plain words a roofer uses. Contractions. No adjectives promoting yourself. No exclamation marks.
It should read like a text message that happens to be an email, not like a brochure.

Sign off exactly:
Owen
Hyperbole Digital

FORMATTING: plain text only. Write any URL bare, exactly as given — https://example.com/p/abc — never as
a markdown link, never as [text](url), never with angle brackets or any other markup. This email is
copied straight into Gmail as plain text, so markdown would appear literally as brackets and parentheses
in front of the prospect. No bold, no italics, no markdown of any kind anywhere in the email.

Output the subject line as the first line, prefixed "Subject: ", then a blank line, then the email body.
No commentary before or after.`

// Fetch a bit of homepage text to give the model a concrete hook. Best-effort:
// a failed/blocked fetch just falls back to a generic (still personalized-by-
// name) draft rather than erroring the whole request.
async function fetchHomepageHook(website: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(website, { signal: controller.signal, redirect: 'follow' })
    clearTimeout(timeout)
    if (!res.ok) return null
    const html = await res.text()
    // Strip tags/scripts to a rough text snippet — enough for a hook, cheap.
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return text.slice(0, 1500) || null
  } catch {
    return null
  }
}

function parseVariants(raw: string): { plain: string; loom: string } {
  // The model is asked to separate the two variants with a marker line.
  const marker = /=+\s*LOOM\s*=+/i
  if (marker.test(raw)) {
    const [plain, loom] = raw.split(marker)
    return { plain: plain.trim(), loom: loom.trim() }
  }
  // Fallback: no marker — use the whole thing as plain, derive a loom stub.
  const plain = raw.trim()
  return { plain, loom: `${plain}\n\nP.S. I recorded a quick 2-minute walkthrough for you — [paste your Loom link here].` }
}

// Shared by generateDrafts and generateValueDrafts below — the personalization
// hook is identical for both; only what's built around it differs.
async function buildOutreachHook(prospect: Prospect): Promise<{ hook: string; hookSource: string }> {
  if (prospect.noWebsite) {
    return {
      hook: `This business has NO website (a prime target — we build sites). Lead with noticing they don't have a website and how that's costing them customers who search for them.`,
      hookSource: 'no-website'
    }
  }
  const homepage = prospect.website ? await fetchHomepageHook(prospect.website) : null
  if (homepage) {
    return {
      hook: `Their website (${prospect.website}) content, for a concrete hook — reference something specific and real from it:\n"""${homepage}"""`,
      hookSource: 'homepage'
    }
  }
  return {
    hook: `They have a website (${prospect.website}) but its content couldn't be fetched. Keep the hook general but genuine; reference that you came across their site.`,
    hookSource: 'homepage-unavailable'
  }
}

export async function generateDrafts(id: string): Promise<Prospect> {
  const prospect = await getProspect(id)
  if (!prospect) throw new Error('Prospect not found')

  const { hook, hookSource } = await buildOutreachHook(prospect)

  const prompt = `Write cold outreach for this prospect:
- Business: ${prospect.name}
- Category: ${prospect.category ?? 'local business'}
- Area: ${prospect.area ?? 'their area'}
${hook}

Produce TWO variants. First the plain email. Then a line with exactly "===== LOOM =====". Then a second version written to accompany a short personal Loom video: open by mentioning you recorded a quick walkthrough, and include the literal text "[paste your Loom link here]" where the link goes. Do not add any other commentary before, between (besides the marker line), or after the two emails.`

  const raw = await complete(prompt, { system: DRAFT_SYSTEM, tier: 'strong', maxTokens: 900 })
  const { plain, loom } = parseVariants(raw)

  const { data, error } = await supabase
    .from('prospects')
    .update({
      draft_plain: plain,
      draft_loom: loom,
      hook_source: hookSource,
      status: prospect.status === 'saved' || prospect.status === 'new' ? 'drafted' : prospect.status,
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(`Failed to save drafts: ${error.message}`)
  return fromRow(data as ProspectRow)
}

// ── Value-prop draft ─────────────────────────────────────────────────────────
// A fuller variant for once a mockup exists to reference — DRAFT_SYSTEM above
// is deliberately capped at 90-130 words with a single soft ask, which can't
// fit four value props without becoming exactly the pushy, templated email it
// was written to avoid. This is a distinct email type, not a longer version
// of the same one: still one human-reviewed draft the operator copies into
// their own Gmail, never sent by the platform.
//
// Service names/descriptions are pulled verbatim from lib/services.ts rather
// than invented here, and deliberately describe only what's actually built —
// "AI search visibility" (what lib/visibility.ts checks: OpenAI + Anthropic),
// not a broader "GEO audit" claim that isn't backed by real capability yet
// (see lib/tiers.ts's GEO bullets, several marked built: false).
const VALUE_DRAFT_SYSTEM = `You write cold outreach for Owen, who runs Hyperbole Digital — a very small
web/SEO shop working with local service businesses. You are writing ONE person to ONE person: a busy
owner who deletes agency pitches in two seconds.

WHAT MAKES THIS EMAIL DIFFERENT: you already did the work. A full redesigned homepage for their business
is built and sitting at a link. That single fact is the entire email. Almost nobody who cold-emails them
has done anything for them first. Lead with it and let it carry the message — do not bury it under
positioning, credentials, or a service menu.

THE TEST every line must pass: could this sentence be sent, unchanged, to a business in a different
industry? If yes, cut it or make it specific to THIS business.

LENGTH: 110-170 words. This is longer than a first-touch note because there is real work to point at,
but every added word must be about THEM. Never pad to seem substantial.

SUBJECT LINE: 2-5 words. Lowercase or sentence case, never Title Case. Point at the thing you made, e.g.
"redesigned your homepage", "made you something", "your site, reworked". Never a benefit claim or a
pitch.

BANNED — do not use these or close variants: "I hope this email finds you well", "reaching out", "we
specialize in", "we help businesses like yours", "online presence", "digital presence", "digital goals",
"take your business to the next level", "elevate", "enhance", "optimize your", "leverage", "solutions",
"in today's digital landscape", "passionate about", "I came across your website and was impressed",
"circle back", "touch base", "let me know if you'd be interested", "at your earliest convenience". Never
open with a dangling participle of admiration ("Admiring your commitment to...").

STRUCTURE, in flowing prose — no headers, no bullet lists:
  1. One specific, verifiable observation about their business. An observation, not flattery.
  2. What you did, immediately: you rebuilt their homepage and it's at a link. Include the link if you
     were given one. Say it plainly — "I redesigned your homepage, here it is" — not "I took the liberty
     of preparing a complimentary concept".
  3. If site audit findings were given to you, work TWO OR THREE in, in words a business owner uses:
     "your site takes about six seconds to load on a phone", never "LCP is 6.2s". Frame them as things
     you noticed while building, never as criticism of them. State ONLY findings you were actually
     given: never invent an issue, never inflate a number, and if none were provided, do not imply you
     analysed their site at all. The recipient can check every one of these — a single invented problem
     discredits the entire email, including the parts that are true.
  4. AT MOST ONE other thing you do — one clause, not one sentence — and only if it genuinely follows
     from something you just said. Naming two is a failure: the moment a second one appears it reads as
     a service menu and the whole email becomes a pitch. Preferring to name ZERO is correct and common;
     the redesign and the findings are already the value. Never write "we" plus a capability ("we manage",
     "we help", "we offer") — write what you noticed or did, in the first person singular.
  5. One low-friction ask, answerable in a word: "Worth a quick call to walk through it?" Never a
     calendar link, never a 30-minute framing, never two asks.

VOICE: plain words their customers would use. Contractions. No self-promoting adjectives. No exclamation
marks. It should read like a capable person who did a favour, not a firm presenting a proposal.

Sign off exactly:
Owen
Hyperbole Digital

FORMATTING: plain text only. Write any URL bare, exactly as given — https://example.com/p/abc — never as
a markdown link, never as [text](url), never with angle brackets or any other markup. This email is
copied straight into Gmail as plain text, so markdown would appear literally as brackets and parentheses
in front of the prospect. No bold, no italics, no markdown of any kind anywhere in the email.

Output the subject line as the first line, prefixed "Subject: ", then a blank line, then the email body.
No commentary before or after.`

export interface ValueDraftOptions {
  // The concept the email should point at. The operator can be looking at any
  // of the recent concepts when they ask for an email, and it must reference
  // the one they actually chose — defaulting to "whatever preview link exists"
  // would silently pitch a different design than the one on their screen.
  previewLink?: string | null
  // Real findings from a crawl of their current site. Only genuine observed
  // problems reach the prompt; the model is told it may not invent any.
  auditPoints?: string[]
  onUsage?: UsageSink
}

export async function generateValueDrafts(id: string, opts: ValueDraftOptions = {}): Promise<Prospect> {
  const prospect = await getProspect(id)
  if (!prospect) throw new Error('Prospect not found')

  const { hook, hookSource } = await buildOutreachHook(prospect)

  // An explicitly chosen concept wins; otherwise fall back to any active
  // (non-revoked) link so the standalone button keeps working as before.
  let link = opts.previewLink ?? null
  if (!link) {
    const previews = await listPreviews(id)
    const activePreview = previews.find(p => !p.revokedAt)
    link = activePreview ? previewUrl(activePreview.previewToken) : null
  }
  const mockupLine = link
    ? `A homepage redesign concept has already been generated for them — link to include: ${link}`
    : 'A homepage redesign concept exists for them but has no shareable link yet — reference it naturally ("I put together a quick concept for your homepage") without inventing a URL; the operator will attach the image or paste the link before sending.'

  // Audit findings are the difference between "I redesigned your homepage"
  // and "I redesigned your homepage, and here are three concrete things
  // costing you traffic today" — the second is the one that earns a reply.
  const auditLine = opts.auditPoints?.length
    ? `Real issues found by an actual crawl of their current site — mention TWO OR THREE of these in plain,
non-technical language, framed as things you noticed and can fix, never as criticism of them personally.
Use ONLY what is listed here; do not invent or embellish any finding:
${opts.auditPoints.map(p => `- ${p}`).join('\n')}`
    : 'No site audit findings are available — do not claim to have analysed their site or reference any specific technical problem.'

  const prompt = `Write a fuller value-prop outreach email for this prospect:
- Business: ${prospect.name}
- Category: ${prospect.category ?? 'local business'}
- Area: ${prospect.area ?? 'their area'}
${hook}

${mockupLine}

${auditLine}

Other real services you may mention (use only these, in your own words, do not invent additional scope).
Remember rule 4: naming at most one is the limit, and naming none is usually better.
- AI search visibility: how their business shows up across the major AI assistants — ChatGPT, Claude,
  Gemini and the rest — when someone asks one of them for a business like theirs. Name at most two
  assistants as examples; listing every one of them turns a sentence into a spec sheet. This is about
  what AI assistants say, which is NOT the same thing as ranking on Google — describe it as the former,
  never as "getting you to the top of Google".
- AI Chat Assistant: a 24/7 assistant on their website that answers customer questions, captures leads, and books calls.

End with a single soft ask to hop on a quick call to walk through the concept.`

  const value = await complete(prompt, {
    system: VALUE_DRAFT_SYSTEM, tier: 'strong', maxTokens: 900, onUsage: opts.onUsage,
  })

  const { data, error } = await supabase
    .from('prospects')
    .update({
      draft_value: value.trim(),
      hook_source: hookSource,
      status: prospect.status === 'saved' || prospect.status === 'new' ? 'drafted' : prospect.status,
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(`Failed to save value draft: ${error.message}`)
  return fromRow(data as ProspectRow)
}

// ── CSV export ────────────────────────────────────────────────────────────────
// The Sheets handoff: opens directly in Google Sheets, drafts included as
// columns so the operator can copy a cell straight into Gmail.
function csvCell(value: string | number | null): string {
  if (value == null) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function prospectsCsv(filter: ProspectFilter = {}): Promise<string> {
  const prospects = await listProspects(filter)
  const header = [
    'name', 'group', 'category', 'area', 'phone', 'email', 'website', 'no_website',
    'rating', 'review_count', 'status', 'maps_url', 'draft_plain', 'draft_loom', 'draft_value', 'notes',
  ]
  const rows = prospects.map(p => [
    p.name, p.groupName, p.category, p.area, p.phone, p.email, p.website, p.noWebsite ? 'yes' : 'no',
    p.rating, p.reviewCount, p.status, p.mapsUrl, p.draftPlain, p.draftLoom, p.draftValue, p.notes,
  ].map(csvCell).join(','))
  return [header.join(','), ...rows].join('\n')
}
