import { getAllClients } from './clients'
import { getLatestSiteHealth, recordSiteHealthCheck } from './site-health'
import { latestBaseline, runSiteBaseline, pagespeedConfigured } from './site-baseline'

// Unattended site checks, so a client's Home page isn't permanently empty now
// that triggering a check by hand is superadmin-only (see routes/clients.ts).
//
// The two checks run on deliberately different cadences because they cost very
// different things:
//
//   * Site health (uptime + SSL) — our own fetch plus a TLS handshake. Free,
//     fast, and the thing most worth catching early: a site going down, or a
//     certificate about to expire. Daily.
//   * Site baseline (PageSpeed) — an external, quota-limited Google API, and
//     the numbers barely move day to day. Weekly.
const HEALTH_MAX_AGE_MS = 20 * 60 * 60 * 1000          // daily
const BASELINE_MAX_AGE_MS = 6.5 * 24 * 60 * 60 * 1000  // weekly

// Deliberately a little under the nominal cadence. Checking "is it a new day?"
// would make the run time drift later and later (each run starts after the
// last one finished) until it eventually skips a day entirely; asking "is the
// stored result older than N?" keeps it anchored. It also means a redeploy
// can't trigger a fresh burst of checks — a result written ten minutes ago is
// still fresh no matter how many times the process restarts.
function olderThan(iso: string | null | undefined, maxAgeMs: number): boolean {
  if (!iso) return true // never checked
  return Date.now() - new Date(iso).getTime() > maxAgeMs
}

// One pass over every active client. Safe to call on a short interval — each
// client is skipped unless its stored result has actually aged out.
export async function runScheduledSiteChecks(): Promise<void> {
  // A client with no domain can't be checked at all, and an inactive one isn't
  // ours to be hitting.
  const clients = (await getAllClients()).filter(c => c.active && c.domain)

  for (const client of clients) {
    // Per-client try/catch on each check: a site that's down (or a cert that
    // fails to parse) makes recordSiteHealthCheck throw, and that must not
    // stop the remaining clients from being checked. A down site is exactly
    // when this matters most.
    try {
      const health = await getLatestSiteHealth(client.id)
      if (olderThan(health?.checkedAt, HEALTH_MAX_AGE_MS)) {
        await recordSiteHealthCheck(client.id, client.domain)
      }
    } catch (err) {
      console.error(`[site-monitor] health check failed for ${client.name}`, err instanceof Error ? err.message : err)
    }

    if (!pagespeedConfigured()) continue
    try {
      const baseline = await latestBaseline(client.id)
      if (olderThan(baseline?.createdAt, BASELINE_MAX_AGE_MS)) {
        await runSiteBaseline(client.id)
      }
    } catch (err) {
      console.error(`[site-monitor] baseline failed for ${client.name}`, err instanceof Error ? err.message : err)
    }
  }
}
