import { google } from 'googleapis'
import { supabase } from './supabase'
import { getClientById } from './clients'

// Google Search Console integration. Auth is ONE service account for the
// whole deployment (GSC_SERVICE_ACCOUNT_JSON env) — the owner builds every
// client's site, so adding that one service account as a restricted user on
// each client's GSC property is a one-time step per client, not a per-client
// OAuth flow. Free, official API; 50k rows/day/property quota is far beyond
// what a small agency needs.

export function gscConfigured(): boolean {
  return !!process.env.GSC_SERVICE_ACCOUNT_JSON
}

function auth() {
  const raw = process.env.GSC_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('GSC_SERVICE_ACCOUNT_JSON is not set')
  const credentials = JSON.parse(raw)
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly']
  })
}

function searchConsole() {
  return google.searchconsole({ version: 'v1', auth: auth() })
}

export interface GscQueryRow {
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface GscTotals {
  clicks: number
  impressions: number
  ctr: number
  position: number
}

// GSC data lags ~2-3 days behind real-time, so "days" is relative to that lag,
// not today.
const GSC_LAG_DAYS = 3

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Pulls top-query performance for a client's connected property over the
// trailing window. Returns null if the client has no GSC property configured.
export async function fetchSearchAnalytics(clientId: string, days = 28): Promise<{ rows: GscQueryRow[]; totals: GscTotals } | null> {
  const client = await getClientById(clientId)
  const property = client?.portalConfig?.gscProperty
  if (!property) return null

  const end = new Date()
  end.setDate(end.getDate() - GSC_LAG_DAYS)
  const start = new Date(end)
  start.setDate(start.getDate() - days)

  const sc = searchConsole()
  const res = await sc.searchanalytics.query({
    siteUrl: property,
    requestBody: {
      startDate: isoDate(start),
      endDate: isoDate(end),
      dimensions: ['query'],
      rowLimit: 100
    }
  })

  const rows: GscQueryRow[] = (res.data.rows ?? []).map(r => ({
    query: r.keys?.[0] ?? '',
    clicks: r.clicks ?? 0,
    impressions: r.impressions ?? 0,
    ctr: r.ctr ?? 0,
    position: r.position ?? 0
  }))

  const totals = rows.reduce<GscTotals>(
    (acc, r) => ({
      clicks: acc.clicks + r.clicks,
      impressions: acc.impressions + r.impressions,
      ctr: 0, // recomputed below
      position: acc.position + r.position * r.impressions
    }),
    { clicks: 0, impressions: 0, ctr: 0, position: 0 }
  )
  totals.ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0
  totals.position = totals.impressions > 0 ? totals.position / totals.impressions : 0

  return { rows, totals }
}

// Persists today's snapshot for the trend chart. Safe to call repeatedly in a
// day — upserts on (client_id, date).
export async function snapshotGsc(clientId: string): Promise<void> {
  const data = await fetchSearchAnalytics(clientId, 28)
  if (!data) return
  const { error } = await supabase.from('gsc_snapshots').upsert(
    {
      client_id: clientId,
      date: isoDate(new Date()),
      queries: data.rows,
      totals: data.totals
    },
    { onConflict: 'client_id,date' }
  )
  if (error) console.error('[gsc] failed to snapshot', error.message)
}

interface SnapshotRow {
  date: string
  queries: GscQueryRow[]
  totals: GscTotals
}

export async function getGscTrend(clientId: string, days = 28): Promise<SnapshotRow[]> {
  const since = new Date()
  since.setDate(since.getDate() - days)
  const { data, error } = await supabase
    .from('gsc_snapshots')
    .select('date, queries, totals')
    .eq('client_id', clientId)
    .gte('date', isoDate(since))
    .order('date', { ascending: true })
  if (error) {
    console.error('[gsc] failed to load trend', error.message)
    return []
  }
  return data as SnapshotRow[]
}

// Latest snapshot's queries, for the "content opportunities" surface: high
// impressions but not yet ranking well (position > 10) — the data-driven
// keyword goldmine that feeds the content engine (slice 5).
export async function getContentOpportunities(clientId: string, limit = 10): Promise<GscQueryRow[]> {
  const { data, error } = await supabase
    .from('gsc_snapshots')
    .select('queries')
    .eq('client_id', clientId)
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return []
  const rows = (data as SnapshotRow).queries ?? []
  return rows
    .filter(r => r.position > 10 && r.impressions > 0)
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit)
}
