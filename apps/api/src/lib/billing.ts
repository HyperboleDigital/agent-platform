import Stripe from 'stripe'
import { supabase } from './supabase'
import { serviceForKey, adsFloorPriceId, type ServiceKey } from './services'
import { tierForKey, tierForPriceId } from './tiers'

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

// Resolve a subscription's base price to a plan-shaped object. The legacy
// Starter/Pro plans were retired 2026-07-24 in favor of the pricing-sheet
// tiers, so a subscription's base price is always a tier price now. Returns null
// for an unrecognized price — callers MUST handle null (the UI degrades to "no
// plan" rather than crashing). conversationCap: tiers don't declare one in the
// sheet yet, so we fall back to 2500. TODO: give tiers their own cap.
export function planForSubscription(priceId: string | null | undefined): PlanInfo | null {
  const tier = tierForPriceId(priceId)
  if (!tier) return null
  return { key: tier.key, priceId: tier.stripePriceId, name: tier.name, monthlyPriceCents: tier.monthlyPriceCents, conversationCap: 2500 }
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

// Durable, shareable Stripe Payment Link for a tier's price — the "send the
// client a link to switch their plan" flow. Created once per tier and cached on
// the Stripe Price's metadata so we reuse the same link instead of spawning a
// fresh one every time. The link is generic (not tied to a customer); the
// caller appends ?client_reference_id=<clientId> so the webhook can attribute
// the resulting subscription to the right client.
export async function getOrCreateTierPaymentLink(tierKey: string): Promise<string> {
  const tier = tierForKey(tierKey)
  if (!tier) throw new Error(`Unknown tier: ${tierKey}`)
  if (!tier.stripePriceId) throw new Error(`Tier "${tier.name}" has no Stripe price configured`)

  const price = await stripe.prices.retrieve(tier.stripePriceId)
  const cachedId = price.metadata?.payment_link_id
  if (cachedId) {
    try {
      const existing = await stripe.paymentLinks.retrieve(cachedId)
      if (existing.active && existing.url) return existing.url
    } catch {
      // cached link was deleted/invalid — fall through and make a fresh one
    }
  }

  const link = await stripe.paymentLinks.create({
    line_items: [{ price: tier.stripePriceId, quantity: 1 }],
    metadata: { tier_key: tier.key },
    subscription_data: { metadata: { tier_key: tier.key } },
  })
  await stripe.prices.update(tier.stripePriceId, {
    metadata: { ...price.metadata, payment_link_id: link.id, payment_link_url: link.url },
  })
  return link.url
}

// A tier Payment Link is shared/generic, so per-client identity rides on the
// checkout session's client_reference_id (appended to the link URL). On
// completion we stamp that client_id onto the new subscription's metadata — so
// every later subscription.* event attributes correctly — then sync as usual.
export async function attributeCheckoutToClient(session: Stripe.Checkout.Session): Promise<void> {
  const clientId = session.client_reference_id
  const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
  if (!clientId || !subId) return
  const updated = await stripe.subscriptions.update(subId, { metadata: { client_id: clientId } })
  await syncSubscriptionFromStripe(updated)
}

export interface ClientSubscriptionSummary {
  id: string
  priceId: string | null
  amountCents: number | null
  status: string
  created: string
  isTracked: boolean // matches our subscriptions row's stripe_subscription_id
}

// Every active Stripe subscription attributed to this client, via the client_id
// we stamp on each subscription's metadata. Tier Payment Links create a fresh
// customer + subscription per payment, so a client who switches tiers can end
// up with more than one active sub — this finds the stale ones so a superadmin
// can cancel them. (Stripe Search is eventually consistent — a just-created sub
// may take a moment to appear.)
export async function listClientSubscriptions(clientId: string): Promise<ClientSubscriptionSummary[]> {
  const tracked = await getSubscription(clientId)
  const res = await stripe.subscriptions.search({
    query: `metadata['client_id']:'${clientId}' AND status:'active'`,
    limit: 100,
  })
  return res.data
    .map(s => {
      const price = s.items.data[0]?.price
      return {
        id: s.id,
        priceId: price?.id ?? null,
        amountCents: price?.unit_amount ?? null,
        status: s.status,
        created: new Date(s.created * 1000).toISOString(),
        isTracked: s.id === tracked?.stripeSubscriptionId,
      }
    })
    .sort((a, b) => a.created.localeCompare(b.created))
}

// Cancel a specific subscription — guarded so it can only cancel a sub actually
// attributed to this client (never someone else's). Used to clear a stale plan
// left over after a tier switch.
//
// Idempotent by design: the goal is "this subscription is not billing anymore",
// so a sub that's already canceled (or already gone) is success, not failure.
// Stripe raises resource_missing / "No such subscription" for BOTH a bogus id
// and an already-canceled one, and the stale-sub list that feeds this is backed
// by Stripe Search — which is eventually consistent and can still show a sub
// that was canceled moments ago. Without this, clicking Cancel on that row
// surfaced a raw, alarming "No such subscription: 'sub_...'" for what was
// actually the desired end state.
export async function cancelClientSubscription(clientId: string, subId: string): Promise<void> {
  let sub: Stripe.Subscription
  try {
    sub = await stripe.subscriptions.retrieve(subId)
  } catch (err) {
    // Nothing to cancel — and nothing to leak, since it doesn't exist.
    if (isResourceMissing(err)) return
    throw err
  }

  if (sub.metadata?.client_id !== clientId) {
    throw new Error('That subscription is not attributed to this client')
  }
  if (sub.status === 'canceled') return // already in the desired state

  try {
    await stripe.subscriptions.cancel(subId)
  } catch (err) {
    // Lost a race with another cancel (or Stripe's own lifecycle) — same
    // end state, so don't turn it into an error.
    if (isResourceMissing(err)) return
    throw err
  }
}

function isResourceMissing(err: unknown): boolean {
  return (err as { code?: string })?.code === 'resource_missing'
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

// Note: base-plan comp (the old Starter/Pro "grant access without a Stripe
// subscription") was removed 2026-07-24 with the plans themselves. Assigning a
// tier via "Save tier" already grants that tier's entitlements (source: 'tier'
// in lib/entitlements.ts) without a charge — that IS the comp path now; the
// tier payment link is the paid path.

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

  // We track ONE current subscription per client, but Payment Links create a new
  // sub per payment, so a client can transiently have several. Guard against an
  // event for a sub that ISN'T the client's current plan clobbering the row —
  // e.g. canceling the OLD plan after a switch fires that old sub's webhook,
  // which would otherwise overwrite the row that correctly points at the NEW
  // plan (the bug this fixes).
  const incomingActive = ACTIVE_STATUSES.has(subscription.status)
  const tracked = await getSubscription(clientId)
  if (tracked?.stripeSubscriptionId && tracked.stripeSubscriptionId !== subscription.id) {
    // A non-active event for a different sub (an old plan being canceled) must
    // never touch the current plan's row.
    if (!incomingActive) return
    // A different ACTIVE sub: adopt it only if it's newer than the tracked one
    // (a genuine switch), not an older sub's renewal event flipping us backward.
    try {
      const trackedStripe = await stripe.subscriptions.retrieve(tracked.stripeSubscriptionId)
      if (ACTIVE_STATUSES.has(trackedStripe.status) && trackedStripe.created > subscription.created) return
    } catch {
      // tracked sub no longer retrievable — fall through and adopt the incoming one
    }
  }

  const items = subscription.items.data
  // The base item is the one whose price is a pricing-sheet tier (not an add-on
  // service). Fall back to item 0 for single-item subscriptions.
  const baseItem = items.find(i => tierForPriceId(i.price?.id) !== null) ?? items[0]
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

  // If the base price is one of the pricing-sheet tiers, keep the client's
  // tier_key/vertical in lockstep with what Stripe is actually billing — this
  // is what stops the "Pricing-sheet tier vs Current plan" drift: once a client
  // pays a tier's link, the label and the charge are the same object. Only
  // while the subscription is active, so a canceled tier doesn't keep asserting
  // the label.
  const tier = tierForPriceId(baseItem?.price?.id)
  if (tier && ACTIVE_STATUSES.has(subscription.status)) {
    const { error: tierErr } = await supabase
      .from('clients')
      .update({ tier_key: tier.key, vertical: tier.vertical })
      .eq('id', clientId)
    if (tierErr) console.error('[billing] failed to sync tier_key', tierErr.message)
  }

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

// ── Paid Ads fee: "greater of a flat floor or a % of spend" ───────────────────
// The floor bills automatically as the recurring `ads` add-on (above). This
// computes the full monthly fee from a client's ad spend, and the OVERAGE — the
// amount above the floor that must be billed as a one-off invoice item when the
// % beats the floor. One flat percentage for all clients; the floor comes from
// the Stripe price (source of truth), passed in.
const ADS_FEE_PCT = Number(process.env.ADS_FEE_PCT ?? 0.15)

export function adsFeePct(): number {
  return ADS_FEE_PCT
}

// The recurring floor amount (cents), read from the single Stripe floor price so
// the source of truth stays Stripe (not a duplicated number in code). Returns 0
// when the price isn't configured.
export async function getAdsFloorCents(): Promise<number> {
  const priceId = adsFloorPriceId()
  if (!priceId) return 0
  try {
    const price = await stripe.prices.retrieve(priceId)
    return price.unit_amount ?? 0
  } catch {
    return 0
  }
}

export interface AdsFeeBreakdown {
  floorCents: number
  pctCents: number      // pct × spend
  feeCents: number      // max(floor, pct×spend)
  overageCents: number  // max(0, pct×spend − floor) — the amount to bill on top of the floor
  pct: number
}

export function computeAdsFee(spendCents: number, floorCents: number): AdsFeeBreakdown {
  const pct = adsFeePct()
  const pctCents = Math.round(Math.max(0, spendCents) * pct)
  const feeCents = Math.max(floorCents, pctCents)
  return { floorCents, pctCents, feeCents, overageCents: Math.max(0, pctCents - floorCents), pct }
}

// Bills the monthly % overage (if any) as a one-off Stripe invoice item that
// rides onto the client's next invoice alongside the recurring floor. Superadmin
// confirm-before-bill — NOT a scheduler. Idempotent per client+period: a second
// call for the same YYYY-MM refuses rather than double-billing.
export async function reconcileAdsFee(clientId: string, spendCents: number, floorCents: number, period: string): Promise<{ billed: boolean; overageCents: number; reason?: string }> {
  const breakdown = computeAdsFee(spendCents, floorCents)
  if (breakdown.overageCents <= 0) return { billed: false, overageCents: 0, reason: 'no_overage' }

  const sub = await getSubscription(clientId)
  if (!sub?.stripeCustomerId || sub.stripeCustomerId === 'comped') return { billed: false, overageCents: breakdown.overageCents, reason: 'no_billable_customer' }

  // Idempotency: refuse a duplicate overage for the same client+period.
  const existing = await stripe.invoiceItems.list({ customer: sub.stripeCustomerId, limit: 100 })
  const dupe = existing.data.find(i => i.metadata?.kind === 'ads_overage' && i.metadata?.period === period && i.metadata?.client_id === clientId)
  if (dupe) return { billed: false, overageCents: breakdown.overageCents, reason: 'already_billed' }

  await stripe.invoiceItems.create({
    customer: sub.stripeCustomerId,
    amount: breakdown.overageCents,
    currency: 'usd',
    description: `Paid Ads management — ${period} performance fee (${Math.round(breakdown.pct * 100)}% of spend above floor)`,
    metadata: { kind: 'ads_overage', period, client_id: clientId }
  })
  return { billed: true, overageCents: breakdown.overageCents }
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
