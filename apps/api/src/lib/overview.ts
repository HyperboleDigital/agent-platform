import { supabase } from './supabase'
import { getAllClients } from './clients'
import { planForSubscription, isActive, type SubscriptionRow } from './billing'
import { serviceForPriceId } from './services'
import { DEFAULT_MONTHLY_CAP } from './usage'

interface SubRow {
  id: string
  client_id: string
  stripe_customer_id: string
  stripe_subscription_id: string | null
  stripe_price_id: string | null
  status: string
  current_period_end: string | null
}

function fromRow(row: SubRow): SubscriptionRow {
  return {
    id: row.id,
    clientId: row.client_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripePriceId: row.stripe_price_id,
    status: row.status,
    currentPeriodEnd: row.current_period_end
  }
}

// Batch variant of billing.ts's getSubscription — one query for every client
// on the Overview page instead of N.
async function getSubscriptionsForClients(clientIds: string[]): Promise<Map<string, SubscriptionRow>> {
  if (clientIds.length === 0) return new Map()
  const { data, error } = await supabase.from('subscriptions').select('*').in('client_id', clientIds)
  if (error) console.error('[overview] failed to load subscriptions', error.message)
  const map = new Map<string, SubscriptionRow>()
  for (const row of (data ?? []) as SubRow[]) map.set(row.client_id, fromRow(row))
  return map
}

// Batched add-on revenue per client, mirroring lib/entitlements.ts's per-client
// subscription_items -> ServiceInfo lookup. Previously missing from MRR
// entirely: only the base plan (subscriptions.stripe_price_id) was summed, so
// a client paying Pro + SEO + Content showed as Pro-only revenue. Fixed here.
async function getAddonRevenueByClient(clientIds: string[]): Promise<Map<string, number>> {
  if (clientIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('subscription_items')
    .select('client_id, stripe_price_id')
    .in('client_id', clientIds)
  if (error) console.error('[overview] failed to load subscription_items', error.message)
  const map = new Map<string, number>()
  for (const row of (data ?? []) as { client_id: string; stripe_price_id: string }[]) {
    const svc = serviceForPriceId(row.stripe_price_id)
    if (svc) map.set(row.client_id, (map.get(row.client_id) ?? 0) + svc.monthlyPriceCents)
  }
  return map
}

// A comped subscription (lib/billing.ts's compClient — friends & family,
// internal test clients) sets status:'active' and a real stripe_price_id so
// isActive()/planForSubscription() behave normally for entitlement purposes, but it
// has NO card on file and collects NO money. Counting it in MRR overstates
// revenue the moment anyone comps a client; this is the one place that
// distinction actually matters.
function isComped(sub: SubscriptionRow | null): boolean {
  return sub?.stripeCustomerId === 'comped'
}

function startOfUtcMonth(): string {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString()
}

// Per-client conversation counts for the current calendar month, in one
// query — Supabase's JS client has no GROUP BY, so tally client-side the
// same way usage.ts's countSince() does for the single-client case.
async function getMonthlyUsageByClient(): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from('message_logs')
    .select('client_id')
    .gte('created_at', startOfUtcMonth())
  if (error) console.error('[overview] failed to count monthly usage', error.message)
  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    const id = (row as { client_id: string }).client_id
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

export interface ClientRollup {
  clientId: string
  name: string
  active: boolean
  planName: string | null
  subscriptionStatus: string | null
  usage: { used: number; cap: number }
  // What this client actually pays: base plan + add-ons, $0 if comped. Drives
  // both the per-client row on the admin Overview table and (summed) the
  // top-line MRR stat — same numbers, one source, can't drift apart.
  mrrCents: number
  comped: boolean
  // True when the subscription is active AND not comped — i.e. genuinely
  // billing. Comped clients have real dashboard access but aren't revenue.
  billingActive: boolean
}

export async function getClientRollups(): Promise<ClientRollup[]> {
  const clients = await getAllClients()
  const clientIds = clients.map(c => c.id)
  const [subsByClient, usageByClient, addonRevenueByClient] = await Promise.all([
    getSubscriptionsForClients(clientIds),
    getMonthlyUsageByClient(),
    getAddonRevenueByClient(clientIds)
  ])

  return clients.map(c => {
    const sub = subsByClient.get(c.id) ?? null
    const plan = sub ? planForSubscription(sub.stripePriceId) : null
    const comped = isComped(sub)
    const billingActive = isActive(sub) && !comped
    const mrrCents = billingActive ? (plan?.monthlyPriceCents ?? 0) + (addonRevenueByClient.get(c.id) ?? 0) : 0
    return {
      clientId: c.id,
      name: c.name,
      active: c.active,
      planName: plan?.name ?? null,
      subscriptionStatus: sub?.status ?? null,
      usage: { used: usageByClient.get(c.id) ?? 0, cap: plan?.conversationCap ?? DEFAULT_MONTHLY_CAP },
      mrrCents,
      comped,
      billingActive
    }
  })
}

export interface OverviewSummary {
  mrrCents: number
  activeClients: number
  totalClients: number
  conversationsThisMonth: number
  clientsNearCap: number // >= 80% of their monthly cap
}

// >= 80% of plan cap flags a client worth a proactive "upgrade?" conversation
// before they actually hit the wall and get blocked mid-month.
const NEAR_CAP_THRESHOLD = 0.8

// Derives the top-line stats from the exact same per-client rollups the
// Overview table renders, rather than re-querying and re-computing separately
// — the two views can no longer disagree about what a client is paying.
export async function getOverviewSummary(): Promise<OverviewSummary> {
  const rollups = await getClientRollups()

  let mrrCents = 0
  let activeClients = 0
  let clientsNearCap = 0
  let conversationsThisMonth = 0

  for (const r of rollups) {
    conversationsThisMonth += r.usage.used
    mrrCents += r.mrrCents
    if (r.billingActive) {
      activeClients++
      if (r.usage.cap > 0 && r.usage.used / r.usage.cap >= NEAR_CAP_THRESHOLD) clientsNearCap++
    }
  }

  return { mrrCents, activeClients, totalClients: rollups.length, conversationsThisMonth, clientsNearCap }
}
