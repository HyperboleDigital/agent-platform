import { google } from 'googleapis'
import { supabase } from './supabase'
import { getClientById } from './clients'

// Google Ads (PPC) read-only reporting. Mirrors lib/gsc.ts: ONE deployment-level
// credential — Hyperbole's manager (MCC) account, via an OAuth2 refresh token +
// a developer token — with each client's Google Ads customer id stored in
// clients.portal_config.googleAdsCustomerId. The client pays Google directly;
// Hyperbole only has manager access to pull performance. Delivery of the
// campaigns is manual; this module is reporting only (no write/automation).
//
// Uses the Google Ads REST API directly (fetch) with an access token minted
// from the refresh token via googleapis' OAuth2 client — deliberately no
// heavyweight google-ads SDK dependency, same "just call the API" spirit as
// gsc.ts.

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION ?? 'v18'

export function googleAdsConfigured(): boolean {
  return !!(
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN &&
    process.env.GOOGLE_ADS_CLIENT_ID &&
    process.env.GOOGLE_ADS_CLIENT_SECRET &&
    process.env.GOOGLE_ADS_REFRESH_TOKEN &&
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
  )
}

export interface AdsCampaign {
  id: string
  name: string
  status: string
  spendCents: number
  impressions: number
  clicks: number
  conversions: number
}

export interface AdsTotals {
  spendCents: number
  impressions: number
  clicks: number
  conversions: number
  conversionsValue: number
  costPerLeadCents: number // spend / conversions
  avgCpcCents: number       // spend / clicks
}

export interface AdsPerformance {
  totals: AdsTotals
  campaigns: AdsCampaign[]
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Google Ads reports money in "micros" (1,000,000 micros = 1 unit of currency).
// We store cents, so micros / 10_000 = cents.
function microsToCents(micros: number | string | undefined): number {
  return Math.round(Number(micros ?? 0) / 10_000)
}

async function accessToken(): Promise<string> {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_ADS_CLIENT_ID,
    process.env.GOOGLE_ADS_CLIENT_SECRET
  )
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN })
  const { token } = await oauth2.getAccessToken()
  if (!token) throw new Error('Failed to mint a Google Ads access token')
  return token
}

// Strip formatting from a customer id ("123-456-7890" → "1234567890").
function normalizeCustomerId(raw: string): string {
  return raw.replace(/\D/g, '')
}

// Pulls campaign performance for a client's connected Google Ads account over
// the trailing window. Returns null if the client has no googleAdsCustomerId
// configured (same "not connected" contract as gsc's fetchSearchAnalytics).
export async function fetchAdsPerformance(clientId: string, days = 30): Promise<AdsPerformance | null> {
  if (!googleAdsConfigured()) throw new Error('Google Ads API is not configured on this deployment')
  const client = await getClientById(clientId)
  const rawCustomerId = client?.portalConfig?.googleAdsCustomerId
  if (!rawCustomerId) return null
  const customerId = normalizeCustomerId(rawCustomerId)
  const loginCustomerId = normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID!)

  const since = new Date()
  since.setDate(since.getDate() - days)
  const query = `
    SELECT campaign.id, campaign.name, campaign.status,
           metrics.cost_micros, metrics.impressions, metrics.clicks,
           metrics.conversions, metrics.conversions_value, metrics.average_cpc
    FROM campaign
    WHERE segments.date BETWEEN '${isoDate(since)}' AND '${isoDate(new Date())}'
  `

  const res = await fetch(
    `https://googleads.googleapis.com/${API_VERSION}/customers/${customerId}/googleAds:searchStream`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${await accessToken()}`,
        'developer-token': process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        'login-customer-id': loginCustomerId,
      },
      body: JSON.stringify({ query }),
    }
  )
  const json = await res.json() as any
  if (!res.ok) {
    const msg = Array.isArray(json) ? json[0]?.error?.message : json?.error?.message
    throw new Error(`Google Ads API: ${msg ?? res.statusText}`)
  }

  // searchStream returns an array of batches, each with a `results` array.
  const batches: any[] = Array.isArray(json) ? json : [json]
  const byCampaign = new Map<string, AdsCampaign>()
  const totals: AdsTotals = {
    spendCents: 0, impressions: 0, clicks: 0, conversions: 0,
    conversionsValue: 0, costPerLeadCents: 0, avgCpcCents: 0,
  }

  for (const batch of batches) {
    for (const row of (batch?.results ?? []) as any[]) {
      const c = row.campaign ?? {}
      const m = row.metrics ?? {}
      const spendCents = microsToCents(m.costMicros)
      const impressions = Number(m.impressions ?? 0)
      const clicks = Number(m.clicks ?? 0)
      const conversions = Number(m.conversions ?? 0)
      const id = String(c.id ?? '')

      const existing = byCampaign.get(id)
      if (existing) {
        existing.spendCents += spendCents
        existing.impressions += impressions
        existing.clicks += clicks
        existing.conversions += conversions
      } else {
        byCampaign.set(id, { id, name: c.name ?? 'Untitled', status: c.status ?? 'UNKNOWN', spendCents, impressions, clicks, conversions })
      }

      totals.spendCents += spendCents
      totals.impressions += impressions
      totals.clicks += clicks
      totals.conversions += conversions
      totals.conversionsValue += Number(m.conversionsValue ?? 0)
    }
  }

  totals.costPerLeadCents = totals.conversions > 0 ? Math.round(totals.spendCents / totals.conversions) : 0
  totals.avgCpcCents = totals.clicks > 0 ? Math.round(totals.spendCents / totals.clicks) : 0

  return { totals, campaigns: [...byCampaign.values()].sort((a, b) => b.spendCents - a.spendCents) }
}

// Persists today's snapshot for the trend chart. Safe to call repeatedly in a
// day — upserts on (client_id, date). Mirrors snapshotGsc.
export async function snapshotAds(clientId: string): Promise<void> {
  const data = await fetchAdsPerformance(clientId, 30)
  if (!data) return
  const { error } = await supabase.from('ads_snapshots').upsert(
    { client_id: clientId, date: isoDate(new Date()), totals: data.totals, campaigns: data.campaigns },
    { onConflict: 'client_id,date' }
  )
  if (error) console.error('[google-ads] failed to snapshot', error.message)
}

interface AdsSnapshotRow {
  date: string
  totals: AdsTotals
  campaigns: AdsCampaign[]
}

export async function getAdsTrend(clientId: string, days = 30): Promise<AdsSnapshotRow[]> {
  const since = new Date()
  since.setDate(since.getDate() - days)
  const { data, error } = await supabase
    .from('ads_snapshots')
    .select('date, totals, campaigns')
    .eq('client_id', clientId)
    .gte('date', isoDate(since))
    .order('date', { ascending: true })
  if (error) {
    console.error('[google-ads] failed to load trend', error.message)
    return []
  }
  return data as AdsSnapshotRow[]
}

// The client's connected Google Ads customer id (for the "connected?" UI state),
// or null. Kept here so routes don't reach into portal_config shape directly.
export async function getConnectedCustomerId(clientId: string): Promise<string | null> {
  const client = await getClientById(clientId)
  return client?.portalConfig?.googleAdsCustomerId ?? null
}
