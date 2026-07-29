import { supabase } from './supabase'
import { getClientById } from './clients'

// "Local Presence" (Offer Sheet A, Tier 2): directory citations + Google
// Business Profile activity. Both are hand-maintained — the GBP API needs
// Google-approved access, and citation submission is manual agency work
// regardless. What the platform provides is the client-facing proof that it's
// happening, plus automatic NAP-drift detection against a canonical record.

export type CitationStatus = 'pending' | 'live' | 'inconsistent' | 'not_applicable'
export type GbpKind = 'post' | 'photo' | 'qa' | 'category' | 'other'

export interface Citation {
  id: string
  clientId: string
  directory: string
  listingUrl: string | null
  status: CitationStatus
  napName: string | null
  napAddress: string | null
  napPhone: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  // Computed, not stored: does this listing's NAP match the client's canonical
  // NAP? null when either side hasn't been recorded yet.
  napMatches: boolean | null
}

export interface GbpActivity {
  id: string
  clientId: string
  kind: GbpKind
  title: string
  url: string | null
  performedAt: string
  notes: string | null
  createdAt: string
}

// The directories that actually matter for local SEO — the concrete backing
// for the sheet's "40+ directories" line. Seeded per client on demand so the
// tracker starts as a real checklist instead of an empty table. Ordered
// roughly by impact: the first several are also the sources AI engines cite
// most for local businesses (see the GEO note in the offer sheet).
export const STANDARD_DIRECTORIES = [
  'Google Business Profile', 'Bing Places', 'Apple Business Connect', 'Yelp',
  'Facebook', 'Better Business Bureau', 'Angi', 'Nextdoor', 'Thumbtack',
  'HomeAdvisor', 'Houzz', 'Porch', 'Yellow Pages', 'Superpages', 'Foursquare',
  'MapQuest', 'Manta', 'Hotfrog', 'Chamber of Commerce', 'Alignable',
  'Brownbook', 'Cylex', 'EZlocal', 'Merchant Circle', 'CitySquares',
  'ShowMeLocal', 'Tupalo', 'iBegin', 'LocalStack', 'Yellowbook',
  'eLocal', 'n49', 'Where To?', 'Opendi', 'FindOpen', 'Zeemaps',
  'Bizapedia', 'US Chamber', 'Local.com', 'InsiderPages', 'Judy\'s Book',
  'Kompass'
]

// NAP comparison is intentionally forgiving: directories reformat punctuation,
// abbreviate "Street"/"St", and vary phone formatting, none of which is real
// drift. Normalizing avoids a wall of false "inconsistent" flags that would
// train everyone to ignore the signal.
function normalizeNap(value: string | null | undefined): string {
  if (!value) return ''
  return value
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .replace(/\b(street|str)\b/g, 'st')
    .replace(/\b(avenue|ave)\b/g, 'ave')
    .replace(/\b(road|rd)\b/g, 'rd')
    .replace(/\b(suite|ste)\b/g, 'ste')
    .replace(/\b(boulevard|blvd)\b/g, 'blvd')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizePhone(value: string | null | undefined): string {
  if (!value) return ''
  const digits = value.replace(/\D/g, '')
  // Treat a leading US country code as equivalent to the 10-digit form.
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

interface CitationRow {
  id: string
  client_id: string
  directory: string
  listing_url: string | null
  status: CitationStatus
  nap_name: string | null
  nap_address: string | null
  nap_phone: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

interface Canonical {
  name?: string
  address?: string
  phone?: string
}

function citationFromRow(row: CitationRow, canonical: Canonical): Citation {
  // Only meaningful once both the canonical record and this listing have
  // values to compare — otherwise "matches" would be a guess.
  const recorded = row.nap_name || row.nap_address || row.nap_phone
  const haveCanonical = canonical.name || canonical.address || canonical.phone
  let napMatches: boolean | null = null
  if (recorded && haveCanonical) {
    const nameOk = !row.nap_name || !canonical.name || normalizeNap(row.nap_name) === normalizeNap(canonical.name)
    const addrOk = !row.nap_address || !canonical.address || normalizeNap(row.nap_address) === normalizeNap(canonical.address)
    const phoneOk = !row.nap_phone || !canonical.phone || normalizePhone(row.nap_phone) === normalizePhone(canonical.phone)
    napMatches = nameOk && addrOk && phoneOk
  }
  return {
    id: row.id,
    clientId: row.client_id,
    directory: row.directory,
    listingUrl: row.listing_url,
    status: row.status,
    napName: row.nap_name,
    napAddress: row.nap_address,
    napPhone: row.nap_phone,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    napMatches
  }
}

async function canonicalNap(clientId: string): Promise<Canonical> {
  const client = await getClientById(clientId)
  const cfg = client?.portalConfig ?? {}
  return { name: cfg.napName, address: cfg.napAddress, phone: cfg.napPhone }
}

export async function listCitations(clientId: string): Promise<Citation[]> {
  const [{ data }, canonical] = await Promise.all([
    supabase.from('citations').select('*').eq('client_id', clientId).order('directory'),
    canonicalNap(clientId)
  ])
  return ((data ?? []) as CitationRow[]).map(r => citationFromRow(r, canonical))
}

export interface CitationInput {
  directory: string
  listingUrl?: string | null
  status?: CitationStatus
  napName?: string | null
  napAddress?: string | null
  napPhone?: string | null
  notes?: string | null
}

export async function upsertCitation(clientId: string, input: CitationInput): Promise<Citation> {
  const row: Record<string, unknown> = {
    client_id: clientId,
    directory: input.directory,
    updated_at: new Date().toISOString()
  }
  if (input.listingUrl !== undefined) row.listing_url = input.listingUrl
  if (input.status !== undefined) row.status = input.status
  if (input.napName !== undefined) row.nap_name = input.napName
  if (input.napAddress !== undefined) row.nap_address = input.napAddress
  if (input.napPhone !== undefined) row.nap_phone = input.napPhone
  if (input.notes !== undefined) row.notes = input.notes

  const { data, error } = await supabase
    .from('citations')
    .upsert(row, { onConflict: 'client_id,directory' })
    .select('*')
    .single()
  if (error) throw new Error(`failed to save citation: ${error.message}`)
  return citationFromRow(data as CitationRow, await canonicalNap(clientId))
}

export async function deleteCitation(clientId: string, id: string): Promise<void> {
  const { error } = await supabase.from('citations').delete().eq('client_id', clientId).eq('id', id)
  if (error) throw new Error(`failed to delete citation: ${error.message}`)
}

// Adds any STANDARD_DIRECTORIES rows this client doesn't already have, leaving
// existing rows (and their recorded status/NAP) untouched. Returns how many
// were added so the caller can report "seeded 42 directories".
export async function seedStandardDirectories(clientId: string): Promise<number> {
  const { data } = await supabase.from('citations').select('directory').eq('client_id', clientId)
  const existing = new Set(((data ?? []) as { directory: string }[]).map(r => r.directory))
  const missing = STANDARD_DIRECTORIES.filter(d => !existing.has(d))
  if (missing.length === 0) return 0

  const { error } = await supabase
    .from('citations')
    .insert(missing.map(directory => ({ client_id: clientId, directory, status: 'pending' })))
  if (error) throw new Error(`failed to seed directories: ${error.message}`)
  return missing.length
}

export interface CitationSummary {
  total: number
  live: number
  pending: number
  inconsistent: number
}

// Rolls the tracker up into the numbers the client actually cares about.
// `inconsistent` counts both hand-flagged rows and ones where the recorded NAP
// disagrees with the canonical record, so drift shows up without anyone
// remembering to set the status by hand.
export function summarizeCitations(citations: Citation[]): CitationSummary {
  const relevant = citations.filter(c => c.status !== 'not_applicable')
  return {
    total: relevant.length,
    live: relevant.filter(c => c.status === 'live' && c.napMatches !== false).length,
    pending: relevant.filter(c => c.status === 'pending').length,
    inconsistent: relevant.filter(c => c.status === 'inconsistent' || c.napMatches === false).length
  }
}

interface GbpRow {
  id: string
  client_id: string
  kind: GbpKind
  title: string
  url: string | null
  performed_at: string
  notes: string | null
  created_at: string
}

function gbpFromRow(row: GbpRow): GbpActivity {
  return {
    id: row.id,
    clientId: row.client_id,
    kind: row.kind,
    title: row.title,
    url: row.url,
    performedAt: row.performed_at,
    notes: row.notes,
    createdAt: row.created_at
  }
}

export async function listGbpActivity(clientId: string, days = 90): Promise<GbpActivity[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)
  const { data } = await supabase
    .from('gbp_activity')
    .select('*')
    .eq('client_id', clientId)
    .gte('performed_at', since)
    .order('performed_at', { ascending: false })
  return ((data ?? []) as GbpRow[]).map(gbpFromRow)
}

export interface GbpActivityInput {
  kind: GbpKind
  title: string
  url?: string | null
  performedAt?: string
  notes?: string | null
}

export async function addGbpActivity(clientId: string, input: GbpActivityInput): Promise<GbpActivity> {
  const { data, error } = await supabase
    .from('gbp_activity')
    .insert({
      client_id: clientId,
      kind: input.kind,
      title: input.title,
      url: input.url ?? null,
      performed_at: input.performedAt ?? new Date().toISOString().slice(0, 10),
      notes: input.notes ?? null
    })
    .select('*')
    .single()
  if (error) throw new Error(`failed to log GBP activity: ${error.message}`)
  return gbpFromRow(data as GbpRow)
}

export async function deleteGbpActivity(clientId: string, id: string): Promise<void> {
  const { error } = await supabase.from('gbp_activity').delete().eq('client_id', clientId).eq('id', id)
  if (error) throw new Error(`failed to delete activity: ${error.message}`)
}

// Posts in the trailing 30 days — the number that proves (or disproves) the
// sheet's "weekly posts" commitment at a glance.
export function postsThisMonth(activity: GbpActivity[]): number {
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
  return activity.filter(a => a.kind === 'post' && a.performedAt >= cutoff).length
}
