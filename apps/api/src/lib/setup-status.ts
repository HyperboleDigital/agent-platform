import { supabase } from './supabase'
import { getClientById } from './clients'
import { getEntitlements } from './entitlements'
import { gscConfigured, fetchSearchAnalytics } from './gsc'
import { getFramerConnection } from './framer'

// Onboarding setup checklist (handoff #3 §2). SEO delivery is gated on a
// handful of one-time manual setup steps; a half-set-up client gets silently
// under-delivered (jobs run against nothing, reports render empty). This
// COMPUTES status from live data — nothing is stored, so it can never drift
// from reality.
//
// The scheduler consults the same checks: rank_check / visibility_poll report
// 'setup_incomplete' instead of erroring when their prerequisite is missing.

export interface SetupItem {
  key: string
  label: string
  complete: boolean
  detail: string
  // Dashboard section the fix lives in ('' = client home) — the banner links
  // straight to the config screen for each incomplete item.
  section: string
}

export interface SetupStatus {
  required: SetupItem[]
  complete: boolean // every required item done
  incompleteCount: number
}

async function countRows(table: string, clientId: string, extra?: (q: any) => any): Promise<number> {
  let q = supabase.from(table).select('id', { count: 'exact', head: true }).eq('client_id', clientId)
  if (extra) q = extra(q)
  const { count, error } = await q
  if (error) {
    console.error(`[setup-status] count ${table} failed:`, error.message)
    return 0
  }
  return count ?? 0
}

export async function computeSetupStatus(clientId: string): Promise<SetupStatus> {
  const [client, ent] = await Promise.all([getClientById(clientId), getEntitlements(clientId)])
  if (!client) throw new Error('Client not found')
  const cfg = client.portalConfig ?? {}

  const items: SetupItem[] = []

  // 1. Google Search Console: configured AND actually returning data (a set
  // property whose service-account permission was never granted still fails).
  let gscOk = false
  let gscDetail = 'Enter the property under Configure on the Site Health Audit card, and add the platform service account to it in Search Console'
  if (!gscConfigured()) {
    gscDetail = 'GSC service account not configured on this deployment (platform level)'
  } else if (cfg.gscProperty) {
    try {
      gscOk = (await fetchSearchAnalytics(clientId, 7)) !== null
      if (!gscOk) gscDetail = `Property "${cfg.gscProperty}" is set but returned no data — check the service account is added to it`
    } catch (err) {
      gscDetail = `Property "${cfg.gscProperty}" fetch failed: ${err instanceof Error ? err.message : 'unknown error'}`
    }
  }
  items.push({ key: 'gscProperty', label: 'Google Search Console connected', complete: gscOk, detail: gscOk ? cfg.gscProperty ?? '' : gscDetail, section: 'seo' })

  // 2. Target keywords (≥5 — fewer and the rank tracker/report movers are noise).
  const keywordCount = await countRows('seo_target_keywords', clientId)
  items.push({
    key: 'targetKeywords', label: 'Target keywords (5+)', complete: keywordCount >= 5,
    detail: `${keywordCount} tracked`, section: 'seo'
  })

  // 3. Visibility queries (≥3 active).
  const queryCount = await countRows('visibility_queries', clientId, q => q.eq('active', true))
  items.push({
    key: 'visibilityQueries', label: 'AI visibility questions (3+)', complete: queryCount >= 3,
    detail: `${queryCount} active`, section: 'seo'
  })

  // 4. Brand terms — the mention-matching anchor for visibility runs.
  const brandOk = (cfg.brandTerms?.length ?? 0) > 0
  items.push({
    key: 'brandTerms', label: 'Brand terms set', complete: brandOk,
    detail: brandOk ? (cfg.brandTerms ?? []).join(', ') : 'Falls back to the client name only — add the name variants AI answers actually use (Configure on the audit card)', section: 'seo'
  })

  // 5. Baseline crawl — at least one finished audit to measure against.
  const crawlCount = await countRows('seo_crawls', clientId, q => q.eq('status', 'finished'))
  items.push({
    key: 'baselineCrawl', label: 'Baseline site audit run', complete: crawlCount > 0,
    detail: crawlCount > 0 ? `${crawlCount} finished` : 'Run the first crawl from the Site Health Audit card', section: 'seo'
  })

  // Local Presence prerequisites — only when the add-on is entitled.
  if (ent.services.local?.entitled) {
    items.push({
      key: 'localPlaceId', label: 'Google Place ID set', complete: !!cfg.placeId,
      detail: cfg.placeId ?? 'Needed for reviews + map-pack tracking', section: 'local'
    })
    const locations = cfg.localLocations?.length ? cfg.localLocations : (cfg.localLocation ? [cfg.localLocation] : [])
    const localOk = locations.length > 0 && (cfg.localKeywords?.length ?? 0) > 0
    items.push({
      key: 'localKeywords', label: 'Local locations + keywords set', complete: localOk,
      detail: localOk ? `${locations.length} location(s), ${cfg.localKeywords?.length} keyword(s)` : 'Map-pack checks need a search location and keywords', section: 'local'
    })
  }

  // Content pipeline prerequisite — only when content is entitled.
  if (ent.services.content?.entitled) {
    const framer = await getFramerConnection(clientId).catch(() => null)
    items.push({
      key: 'framerConnection', label: 'Framer publishing connected', complete: !!framer,
      detail: framer ? 'Connected' : 'Connect the Framer project so approved posts can publish', section: 'content'
    })
  }

  const incomplete = items.filter(i => !i.complete)
  return { required: items, complete: incomplete.length === 0, incompleteCount: incomplete.length }
}

// Cheap prerequisite probes for the scheduler — no live GSC call, just the
// row counts the two data jobs depend on. Returns null when the prerequisite
// is met, or the human-readable gap when it isn't.
export async function rankCheckPrereqGap(clientId: string): Promise<string | null> {
  const n = await countRows('seo_target_keywords', clientId)
  return n > 0 ? null : 'No tracked keywords configured — complete the setup checklist (target keywords)'
}

export async function visibilityPrereqGap(clientId: string): Promise<string | null> {
  const n = await countRows('visibility_queries', clientId, q => q.eq('active', true))
  return n > 0 ? null : 'No active visibility queries — complete the setup checklist (AI visibility questions)'
}
