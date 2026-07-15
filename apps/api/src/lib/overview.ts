import { supabase } from './supabase'
import { getAllClients } from './clients'
import { planForPriceId, isActive, type SubscriptionRow } from './billing'
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
}

export async function getClientRollups(): Promise<ClientRollup[]> {
  const clients = await getAllClients()
  const [subsByClient, usageByClient] = await Promise.all([
    getSubscriptionsForClients(clients.map(c => c.id)),
    getMonthlyUsageByClient()
  ])

  return clients.map(c => {
    const sub = subsByClient.get(c.id) ?? null
    const plan = sub ? planForPriceId(sub.stripePriceId) : null
    return {
      clientId: c.id,
      name: c.name,
      active: c.active,
      planName: plan?.name ?? null,
      subscriptionStatus: sub?.status ?? null,
      usage: { used: usageByClient.get(c.id) ?? 0, cap: plan?.conversationCap ?? DEFAULT_MONTHLY_CAP }
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

export async function getOverviewSummary(): Promise<OverviewSummary> {
  const clients = await getAllClients()
  const [subsByClient, usageByClient] = await Promise.all([
    getSubscriptionsForClients(clients.map(c => c.id)),
    getMonthlyUsageByClient()
  ])

  let mrrCents = 0
  let activeClients = 0
  let clientsNearCap = 0
  let conversationsThisMonth = 0

  for (const c of clients) {
    const sub = subsByClient.get(c.id) ?? null
    const used = usageByClient.get(c.id) ?? 0
    conversationsThisMonth += used

    if (isActive(sub)) {
      activeClients++
      const plan = planForPriceId(sub!.stripePriceId)
      if (plan) mrrCents += plan.monthlyPriceCents
      const cap = plan?.conversationCap ?? DEFAULT_MONTHLY_CAP
      if (cap > 0 && used / cap >= NEAR_CAP_THRESHOLD) clientsNearCap++
    }
  }

  return { mrrCents, activeClients, totalClients: clients.length, conversationsThisMonth, clientsNearCap }
}
