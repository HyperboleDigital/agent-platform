// Auto-pulled Google Business Profile reviews via the Places API (New) —
// unlike the full Business Profile Performance/Content API, Place Details
// needs only an API key (no Google-approved OAuth), so this is the one part
// of "GBP tracking" we can get for free instead of hand-logging.

const FIELD_MASK = 'id,displayName,rating,userRatingCount,googleMapsUri,reviews'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // reviews don't change fast enough to justify hammering the quota

export function placesConfigured(): boolean {
  return !!process.env.PLACES_API_KEY
}

export interface PlaceReview {
  authorName: string
  rating: number
  text: string | null
  relativeTime: string
  publishTime: string
}

export interface PlaceSummary {
  placeId: string
  name: string
  rating: number | null
  reviewCount: number
  mapsUrl: string | null
  reviews: PlaceReview[]
  fetchedAt: string
}

const cache = new Map<string, { at: number; summary: PlaceSummary }>()

export async function fetchPlaceSummary(placeId: string): Promise<PlaceSummary> {
  const cached = cache.get(placeId)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.summary

  const apiKey = process.env.PLACES_API_KEY
  if (!apiKey) throw new Error('Places API not configured')

  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': FIELD_MASK }
  })
  const json = await res.json() as any
  if (!res.ok) {
    throw new Error(`Places API: ${json?.error?.message ?? res.statusText}`)
  }

  const summary: PlaceSummary = {
    placeId,
    name: json.displayName?.text ?? 'Unknown business',
    rating: json.rating ?? null,
    reviewCount: json.userRatingCount ?? 0,
    mapsUrl: json.googleMapsUri ?? null,
    reviews: ((json.reviews ?? []) as any[]).map(r => ({
      authorName: r.authorAttribution?.displayName ?? 'Anonymous',
      rating: r.rating ?? 0,
      text: r.text?.text ?? null,
      relativeTime: r.relativePublishTimeDescription ?? '',
      publishTime: r.publishTime ?? ''
    })),
    fetchedAt: new Date().toISOString()
  }

  cache.set(placeId, { at: Date.now(), summary })
  return summary
}

export interface PlaceCandidate {
  placeId: string
  name: string
  address: string | null
}

// Resolve a business name to Place ID candidates via Places Text Search, so
// the operator can pick their business from a list instead of hunting down a
// cryptic ChIJ… ID in Google's Place ID Finder.
export async function searchBusinesses(query: string): Promise<PlaceCandidate[]> {
  const apiKey = process.env.PLACES_API_KEY
  if (!apiKey) throw new Error('Places API not configured')
  if (!query.trim()) return []

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress'
    },
    body: JSON.stringify({ textQuery: query })
  })
  const json = await res.json() as any
  if (!res.ok) throw new Error(`Places API: ${json?.error?.message ?? res.statusText}`)

  return ((json.places ?? []) as any[]).slice(0, 8).map(p => ({
    placeId: p.id,
    name: p.displayName?.text ?? 'Unknown',
    address: p.formattedAddress ?? null
  }))
}

// ── Prospecting discovery ─────────────────────────────────────────────────────
// Bulk business discovery for the cold-outreach tool: find businesses by
// category + area, with the fields outreach needs (phone, website presence,
// rating). Deliberately separate from searchBusinesses/fetchPlaceSummary — the
// website + phone fields sit in the Places "Enterprise" SKU (pricier per call
// than the reviews call), so we don't widen those cheap paths. Page count is
// capped to bound cost; result count is surfaced so spend stays visible.

const DISCOVERY_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.googleMapsUri',
].join(',')

const MAX_DISCOVERY_PAGES = 3 // Places returns 20/page → ~60 results max per search

export interface ProspectCandidate {
  placeId: string
  name: string
  address: string | null
  phone: string | null
  website: string | null
  noWebsite: boolean
  rating: number | null
  reviewCount: number
  mapsUrl: string | null
}

export interface DiscoveryOptions {
  category: string          // e.g. "med spa"
  area: string              // e.g. "Tampa, FL"
  minRating?: number
  minReviewCount?: number
  noWebsiteOnly?: boolean
}

export async function discoverBusinesses(opts: DiscoveryOptions): Promise<ProspectCandidate[]> {
  const apiKey = process.env.PLACES_API_KEY
  if (!apiKey) throw new Error('Places API not configured')

  const category = opts.category.trim()
  const area = opts.area.trim()
  if (!category || !area) return []
  const textQuery = `${category} in ${area}`

  const out: ProspectCandidate[] = []
  let pageToken: string | undefined
  for (let page = 0; page < MAX_DISCOVERY_PAGES; page++) {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': `${DISCOVERY_FIELD_MASK},nextPageToken`,
      },
      body: JSON.stringify(pageToken ? { textQuery, pageToken } : { textQuery }),
    })
    const json = await res.json() as any
    if (!res.ok) throw new Error(`Places API: ${json?.error?.message ?? res.statusText}`)

    for (const p of (json.places ?? []) as any[]) {
      out.push({
        placeId: p.id,
        name: p.displayName?.text ?? 'Unknown business',
        address: p.formattedAddress ?? null,
        phone: p.nationalPhoneNumber ?? null,
        website: p.websiteUri ?? null,
        noWebsite: !p.websiteUri,
        rating: p.rating ?? null,
        reviewCount: p.userRatingCount ?? 0,
        mapsUrl: p.googleMapsUri ?? null,
      })
    }

    pageToken = json.nextPageToken
    if (!pageToken) break
  }

  return out.filter(c => {
    if (opts.noWebsiteOnly && !c.noWebsite) return false
    if (opts.minRating != null && (c.rating ?? 0) < opts.minRating) return false
    if (opts.minReviewCount != null && c.reviewCount < opts.minReviewCount) return false
    return true
  })
}
