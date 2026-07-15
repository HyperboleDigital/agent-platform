// In-memory sliding-window rate limiter, keyed by an arbitrary string (e.g.
// `chat:<clientId>`). Catches bursts/floods cheaply without a DB round-trip.
// Single-instance only — fine for the current deployment; move to Redis if the
// API is ever horizontally scaled. Sustained/daily abuse is caught separately
// by the DB-backed caps in lib/usage.ts.

const buckets = new Map<string, number[]>()

// Returns true if this hit EXCEEDS the limit (i.e. should be blocked).
export function overLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const hits = (buckets.get(key) ?? []).filter(t => now - t < windowMs)
  hits.push(now)
  buckets.set(key, hits)
  return hits.length > max
}

// Periodic sweep so keys for idle clients don't accumulate forever.
const SWEEP_MS = 10 * 60 * 1000
setInterval(() => {
  const now = Date.now()
  for (const [key, hits] of buckets) {
    const live = hits.filter(t => now - t < SWEEP_MS)
    if (live.length === 0) buckets.delete(key)
    else buckets.set(key, live)
  }
}, SWEEP_MS).unref()
