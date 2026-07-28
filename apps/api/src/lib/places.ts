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
