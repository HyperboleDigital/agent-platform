import { supabase } from './supabase'
import { discoverBusinesses, type DiscoveryOptions, type ProspectCandidate } from './places'
import { complete } from './llm/complete'

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
  hookSource: string | null
  notes: string | null
  createdAt: string
}

interface ProspectRow {
  id: string
  place_id: string | null
  name: string
  category: string | null
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
    hookSource: r.hook_source,
    notes: r.notes,
    createdAt: r.created_at,
  }
}

// ── Discovery ─────────────────────────────────────────────────────────────────
// Live Places lookup — returns candidates NOT yet persisted, so the operator can
// review before saving the good ones.
export async function discoverProspects(opts: DiscoveryOptions): Promise<ProspectCandidate[]> {
  return discoverBusinesses(opts)
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
export async function listProspects(status?: ProspectStatus): Promise<Prospect[]> {
  let query = supabase.from('prospects').select('*').order('created_at', { ascending: false })
  if (status) query = query.eq('status', status)
  const { data, error } = await query
  if (error) throw new Error(`Failed to list prospects: ${error.message}`)
  return ((data ?? []) as ProspectRow[]).map(fromRow)
}

export async function getProspect(id: string): Promise<Prospect | null> {
  const { data, error } = await supabase.from('prospects').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`Failed to load prospect: ${error.message}`)
  return data ? fromRow(data as ProspectRow) : null
}

// Save a discovered candidate. Upsert on place_id so the same business found
// across repeated searches collapses to one row (23505 unique-violation no-op,
// same pattern as addTargetKeyword).
export async function saveProspect(
  candidate: ProspectCandidate,
  context: { category: string; area: string }
): Promise<Prospect> {
  const { data, error } = await supabase
    .from('prospects')
    .upsert({
      place_id: candidate.placeId,
      name: candidate.name,
      category: context.category,
      area: context.area,
      phone: candidate.phone,
      website: candidate.website,
      maps_url: candidate.mapsUrl,
      rating: candidate.rating,
      review_count: candidate.reviewCount,
      status: 'saved',
    }, { onConflict: 'place_id' })
    .select()
    .single()
  if (error) throw new Error(`Failed to save prospect: ${error.message}`)
  return fromRow(data as ProspectRow)
}

export async function updateProspect(
  id: string,
  patch: { status?: ProspectStatus; email?: string | null; notes?: string | null }
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

// ── Draft generation ──────────────────────────────────────────────────────────
// One LLM call returns BOTH variants (plain + Loom) so the operator can A/B test
// with/without a video. The personalization hook is a light homepage fetch for
// has-website prospects, or the "you don't have a site, we build them" angle for
// no-website ones (the prime targets). Deep SEO audits stay a separate action.

const DRAFT_SYSTEM = `You write short, genuine, personalized B2B cold outreach emails for Hyperbole Digital, a small digital agency offering SEO, AI-search visibility, websites, and a chat assistant for local service businesses. Voice: warm, specific, low-pressure, human — NOT salesy or templated. No hype, no "I hope this email finds you well," no fake urgency. 90-130 words. Reference something concrete about the business. End with a soft, single ask (a quick call or reply). Sign off as "Owen, Hyperbole Digital".`

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

export async function generateDrafts(id: string): Promise<Prospect> {
  const prospect = await getProspect(id)
  if (!prospect) throw new Error('Prospect not found')

  let hook: string
  let hookSource: string
  if (prospect.noWebsite) {
    hook = `This business has NO website (a prime target — we build sites). Lead with noticing they don't have a website and how that's costing them customers who search for them.`
    hookSource = 'no-website'
  } else {
    const homepage = prospect.website ? await fetchHomepageHook(prospect.website) : null
    if (homepage) {
      hook = `Their website (${prospect.website}) content, for a concrete hook — reference something specific and real from it:\n"""${homepage}"""`
      hookSource = 'homepage'
    } else {
      hook = `They have a website (${prospect.website}) but its content couldn't be fetched. Keep the hook general but genuine; reference that you came across their site.`
      hookSource = 'homepage-unavailable'
    }
  }

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

// ── CSV export ────────────────────────────────────────────────────────────────
// The Sheets handoff: opens directly in Google Sheets, drafts included as
// columns so the operator can copy a cell straight into Gmail.
function csvCell(value: string | number | null): string {
  if (value == null) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function prospectsCsv(status?: ProspectStatus): Promise<string> {
  const prospects = await listProspects(status)
  const header = [
    'name', 'category', 'area', 'phone', 'email', 'website', 'no_website',
    'rating', 'review_count', 'status', 'maps_url', 'draft_plain', 'draft_loom', 'notes',
  ]
  const rows = prospects.map(p => [
    p.name, p.category, p.area, p.phone, p.email, p.website, p.noWebsite ? 'yes' : 'no',
    p.rating, p.reviewCount, p.status, p.mapsUrl, p.draftPlain, p.draftLoom, p.notes,
  ].map(csvCell).join(','))
  return [header.join(','), ...rows].join('\n')
}
