import Stripe from 'stripe'
import { supabase } from './supabase'
import { serviceForKey, type ServiceKey } from './services'

// Pin the API version explicitly rather than inheriting the account's
// dashboard-configured default, which may be older than what this SDK's
// types expect (e.g. current_period_end living on subscription items, not
// the subscription itself, is a version-dependent shape).
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', { apiVersion: '2026-06-24.dahlia' })

export function billingConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

// Plan metadata keyed by Stripe price ID rather than a hardcoded enum column
// in the DB — adding a tier, repricing, or later attaching a metered usage
// component to a plan is a config change here, not a schema migration.
export interface PlanInfo {
  key: string
  priceId: string
  name: string
  monthlyPriceCents: number
  conversationCap: number
}

const PLANS: Record<string, PlanInfo> = {
  [process.env.STRIPE_PRICE_STARTER ?? '']: {
    key: 'starter', priceId: process.env.STRIPE_PRICE_STARTER ?? '',
    name: 'Starter', monthlyPriceCents: 19900, conversationCap: 500
  },
  [process.env.STRIPE_PRICE_PRO ?? '']: {
    key: 'pro', priceId: process.env.STRIPE_PRICE_PRO ?? '',
    name: 'Pro', monthlyPriceCents: 39900, conversationCap: 2500
  }
}

export function planForPriceId(priceId: string | null | undefined): PlanInfo | null {
  if (!priceId) return null
  return PLANS[priceId] ?? null
}

export function listPlans(): PlanInfo[] {
  return Object.values(PLANS)
}

export interface SubscriptionRow {
  id: string
  clientId: string
  stripeCustomerId: string
  stripeSubscriptionId: string | null
  stripePriceId: string | null
  status: string
  currentPeriodEnd: string | null
}

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

export async function getSubscription(clientId: string): Promise<SubscriptionRow | null> {
  const { data } = await supabase.from('subscriptions').select('*').eq('client_id', clientId).single()
  return data ? fromRow(data as SubRow) : null
}

// A subscription counts as "active" (grants access) in these Stripe states —
// past_due gets a grace period rather than an instant hard-cutoff, since
// that's usually a card retry in progress, not intentional churn.
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due'])

export function isActive(sub: SubscriptionRow | null): boolean {
  return !!sub && ACTIVE_STATUSES.has(sub.status)
}

// Ensures a Stripe Customer exists for this client and a placeholder
// subscriptions row anchors it, so the portal/webhook always have somewhere
// to write to even before the first checkout completes.
export async function getOrCreateStripeCustomer(clientId: string, clientName: string): Promise<string> {
  const existing = await getSubscription(clientId)
  if (existing?.stripeCustomerId) return existing.stripeCustomerId

  const customer = await stripe.customers.create({ name: clientName, metadata: { client_id: clientId } })
  await supabase.from('subscriptions').upsert({
    client_id: clientId,
    stripe_customer_id: customer.id,
    status: 'incomplete',
    updated_at: new Date().toISOString()
  }, { onConflict: 'client_id' })
  return customer.id
}

export async function createCheckoutSession(
  clientId: string,
  clientName: string,
  priceId: string,
  successUrl: string,
  cancelUrl: string,
  addonPriceIds: string[] = []
): Promise<string> {
  const customerId = await getOrCreateStripeCustomer(clientId, clientName)
  // Base plan is line item 0; any add-on services a new customer chose at
  // signup ride along on the same subscription.
  const line_items = [{ price: priceId, quantity: 1 }, ...addonPriceIds.map(price => ({ price, quantity: 1 }))]
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items,
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: clientId,
    subscription_data: { metadata: { client_id: clientId } }
  })
  if (!session.url) throw new Error('Stripe did not return a checkout URL')
  return session.url
}

export async function createPortalSession(clientId: string, returnUrl: string): Promise<string> {
  const sub = await getSubscription(clientId)
  if (!sub) throw new Error('No billing account for this client yet')
  const session = await stripe.billingPortal.sessions.create({
    customer: sub.stripeCustomerId,
    return_url: returnUrl
  })
  return session.url
}

// Superadmin comp: grants access without a real Stripe subscription (friends
// & family, internal test clients). Sentinel stripe_customer_id/price so
// `isActive` and plan resolution behave sanely; a later real checkout simply
// overwrites this row via syncSubscriptionFromStripe.
export async function compClient(clientId: string, planKey: 'starter' | 'pro' = 'pro'): Promise<void> {
  const priceId = Object.entries(PLANS).find(([, p]) => p.key === planKey)?.[0]
  const { error } = await supabase.from('subscriptions').upsert({
    client_id: clientId,
    stripe_customer_id: 'comped',
    stripe_subscription_id: null,
    stripe_price_id: priceId ?? null,
    status: 'active',
    updated_at: new Date().toISOString()
  }, { onConflict: 'client_id' })
  if (error) throw error
}

// Upserts our local mirror of a Stripe subscription — called from the webhook
// handler on every subscription lifecycle event. `clientId` is read from the
// subscription's metadata (set at checkout) since Stripe events don't
// otherwise carry our internal ID. Also mirrors ALL line items into
// subscription_items so add-on service entitlements stay accurate.
export async function syncSubscriptionFromStripe(subscription: Stripe.Subscription): Promise<void> {
  const clientId = subscription.metadata?.client_id
  if (!clientId) {
    console.error('[billing] webhook subscription missing client_id metadata', subscription.id)
    return
  }
  const items = subscription.items.data
  // The base plan item is the one whose price is a PLAN (not an add-on
  // service). Fall back to item 0 for legacy single-item subscriptions.
  const baseItem = items.find(i => planForPriceId(i.price?.id) !== null) ?? items[0]
  // current_period_end lives on the subscription item in newer API versions,
  // top-level on the subscription in older ones — the account's configured
  // webhook API version determines which shape actually arrives, so accept
  // either rather than assume.
  const periodEndUnix = baseItem?.current_period_end ?? (subscription as unknown as { current_period_end?: number }).current_period_end
  const { error } = await supabase.from('subscriptions').upsert({
    client_id: clientId,
    stripe_customer_id: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    stripe_subscription_id: subscription.id,
    stripe_price_id: baseItem?.price?.id ?? null,
    status: subscription.status,
    current_period_end: periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null,
    updated_at: new Date().toISOString()
  }, { onConflict: 'client_id' })
  if (error) console.error('[billing] failed to sync subscription', error.message)

  await syncSubscriptionItems(clientId, items)
}

// Replaces our subscription_items mirror for a client with the exact set of
// items currently on the Stripe subscription: upsert everything present, then
// delete any stale rows (items removed on Stripe). Keyed on the Stripe item ID
// so it's idempotent across repeated webhook deliveries.
async function syncSubscriptionItems(clientId: string, items: Stripe.SubscriptionItem[]): Promise<void> {
  const now = new Date().toISOString()
  const rows = items
    .filter(i => i.price?.id)
    .map(i => ({
      client_id: clientId,
      stripe_subscription_item_id: i.id,
      stripe_price_id: i.price.id,
      quantity: i.quantity ?? 1,
      updated_at: now
    }))

  if (rows.length > 0) {
    const { error } = await supabase.from('subscription_items').upsert(rows, { onConflict: 'stripe_subscription_item_id' })
    if (error) console.error('[billing] failed to upsert subscription_items', error.message)
  }

  const keepIds = rows.map(r => r.stripe_subscription_item_id)
  let del = supabase.from('subscription_items').delete().eq('client_id', clientId)
  if (keepIds.length > 0) del = del.not('stripe_subscription_item_id', 'in', `(${keepIds.join(',')})`)
  const { error: delError } = await del
  if (delError) console.error('[billing] failed to prune subscription_items', delError.message)
}

// Adds an add-on service to a client's EXISTING subscription. The customer
// already has a payment method from the initial checkout, so we attach a new
// line item directly (Checkout Sessions can't append to an existing sub) and
// invoice the prorated amount immediately, then re-sync so the UI reflects the
// new entitlement without waiting for the webhook.
export async function addServiceToSubscription(clientId: string, serviceKey: ServiceKey): Promise<void> {
  const service = serviceForKey(serviceKey)
  if (!service) throw new Error(`Unknown service: ${serviceKey}`)
  if (service.status !== 'available' || !service.priceId) throw new Error(`Service not available: ${serviceKey}`)

  const sub = await getSubscription(clientId)
  if (!sub?.stripeSubscriptionId) throw new Error('No active subscription to add a service to')
  if (sub.stripeCustomerId === 'comped') throw new Error('Comped clients cannot purchase add-ons — grant the service instead')

  // Guard against duplicate line items for the same service.
  const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)
  const already = stripeSub.items.data.find(i => i.price?.id === service.priceId)
  if (!already) {
    await stripe.subscriptionItems.create({
      subscription: sub.stripeSubscriptionId,
      price: service.priceId,
      quantity: 1,
      proration_behavior: 'always_invoice'
    })
  }

  const fresh = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)
  await syncSubscriptionFromStripe(fresh)
}

// Removes an add-on service from a client's subscription, invoicing any
// proration credit immediately, then re-syncs.
export async function removeServiceFromSubscription(clientId: string, serviceKey: ServiceKey): Promise<void> {
  const service = serviceForKey(serviceKey)
  if (!service) throw new Error(`Unknown service: ${serviceKey}`)

  const sub = await getSubscription(clientId)
  if (!sub?.stripeSubscriptionId) throw new Error('No active subscription')

  const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)
  const item = stripeSub.items.data.find(i => i.price?.id === service.priceId)
  if (item) {
    await stripe.subscriptionItems.del(item.id, { proration_behavior: 'always_invoice' })
  }

  const fresh = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)
  await syncSubscriptionFromStripe(fresh)
}

// Superadmin comp for an individual add-on service (no Stripe purchase).
// Upserts an unrevoked grant; re-comping an already-granted service clears any
// prior revoked_at.
export async function grantService(clientId: string, serviceKey: ServiceKey, grantedBy: string): Promise<void> {
  if (!serviceForKey(serviceKey)) throw new Error(`Unknown service: ${serviceKey}`)
  const { error } = await supabase.from('service_grants').upsert({
    client_id: clientId,
    service_key: serviceKey,
    source: 'comp',
    granted_by: grantedBy,
    revoked_at: null
  }, { onConflict: 'client_id,service_key' })
  if (error) throw error
}

// Soft-revokes a comped service grant.
export async function revokeService(clientId: string, serviceKey: ServiceKey): Promise<void> {
  const { error } = await supabase
    .from('service_grants')
    .update({ revoked_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .eq('service_key', serviceKey)
  if (error) throw error
}
