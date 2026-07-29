import { Router } from 'express'
import { z } from 'zod'
import type { Request, Response } from 'express'
import { getClientById } from '../lib/clients'
import { getIdentity, canAccessClient } from '../lib/authz'
import {
  stripe, billingConfigured, planForSubscription,
  getSubscription, createCheckoutSession, createPortalSession, syncSubscriptionFromStripe,
  addServiceToSubscription, removeServiceFromSubscription, grantService, revokeService,
  getOrCreateTierPaymentLink, attributeCheckoutToClient,
  listClientSubscriptions, cancelClientSubscription,
  computeAdsFee, reconcileAdsFee, getAdsFloorCents
} from '../lib/billing'
import { listServices, serviceForKey } from '../lib/services'
import { getEntitlements } from '../lib/entitlements'
import { listTiers, tierForKey } from '../lib/tiers'

export const billingRouter = Router()

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'http://localhost:5173'

const SERVICE_KEYS = ['seo', 'content', 'reviews', 'social', 'local', 'chat', 'ads'] as const

// The finalized pricing-sheet tier catalog (Local/B2B x Care/mid/top) — see
// lib/tiers.ts. Hardcoded, not Stripe-backed yet.
billingRouter.get('/tiers', (_req, res) => {
  res.json(listTiers())
})

// Add-on service catalog, for the dashboard marketplace / locked sections.
billingRouter.get('/services', (_req, res) => {
  res.json(listServices())
})

const checkoutSchema = z.object({ priceId: z.string().min(1), addonPriceIds: z.array(z.string()).optional() })

// Starts a Stripe Checkout session for the caller's client, subscribing to
// the given price. Returns a URL to redirect the browser to.
billingRouter.post('/:id/checkout', async (req, res) => {
  const identity = getIdentity(req)
  if (!identity) return res.status(401).json({ error: 'Unauthorized' })
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  if (!billingConfigured()) return res.status(500).json({ error: 'Billing not configured' })

  const parsed = checkoutSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' })

  const client = await getClientById(req.params.id)
  if (!client) return res.status(404).json({ error: 'Not found' })

  try {
    const url = await createCheckoutSession(
      client.id,
      client.name,
      parsed.data.priceId,
      `${DASHBOARD_URL}/clients/${client.id}?billing=success`,
      `${DASHBOARD_URL}/clients/${client.id}?billing=cancelled`,
      parsed.data.addonPriceIds ?? []
    )
    res.json({ url })
  } catch (err) {
    console.error('[billing] checkout error', err)
    res.status(500).json({ error: 'Failed to start checkout' })
  }
})

// Superadmin: a shareable Stripe Payment Link for a given tier, attributed to
// this client via client_reference_id. Send it to the client to move them onto
// that tier — when they pay, the webhook (checkout.session.completed) attaches
// the subscription and syncs the client's tier_key to match.
billingRouter.get('/:id/tier-link', async (req, res) => {
  const identity = getIdentity(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  if (!billingConfigured()) return res.status(500).json({ error: 'Billing not configured' })

  const tierKey = typeof req.query.tierKey === 'string' ? req.query.tierKey : ''
  const tier = tierForKey(tierKey)
  if (!tier) return res.status(400).json({ error: 'Unknown tier' })

  const client = await getClientById(req.params.id)
  if (!client) return res.status(404).json({ error: 'Not found' })

  try {
    const base = await getOrCreateTierPaymentLink(tierKey)
    const sep = base.includes('?') ? '&' : '?'
    const url = `${base}${sep}client_reference_id=${encodeURIComponent(client.id)}`
    res.json({ url })
  } catch (err) {
    console.error('[billing] tier-link error', err)
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create payment link' })
  }
})

// Superadmin: all active Stripe subs attributed to this client — used to spot a
// stale plan still billing after a tier switch (Payment Links make a new sub
// each time). The one matching our tracked sub is `isTracked: true`.
billingRouter.get('/:id/subscriptions', async (req, res) => {
  const identity = getIdentity(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  if (!billingConfigured()) return res.status(500).json({ error: 'Billing not configured' })
  try {
    res.json(await listClientSubscriptions(req.params.id))
  } catch (err) {
    console.error('[billing] list subscriptions error', err)
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to list subscriptions' })
  }
})

// Superadmin: cancel a specific (usually stale) subscription for this client.
billingRouter.post('/:id/subscriptions/:subId/cancel', async (req, res) => {
  const identity = getIdentity(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  if (!billingConfigured()) return res.status(500).json({ error: 'Billing not configured' })
  try {
    await cancelClientSubscription(req.params.id, req.params.subId)
    res.json({ ok: true })
  } catch (err) {
    console.error('[billing] cancel subscription error', err)
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to cancel subscription' })
  }
})

// Stripe Customer Portal — self-serve manage/cancel/update payment method.
billingRouter.post('/:id/portal', async (req, res) => {
  const identity = getIdentity(req)
  if (!identity) return res.status(401).json({ error: 'Unauthorized' })
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  if (!billingConfigured()) return res.status(500).json({ error: 'Billing not configured' })

  try {
    const url = await createPortalSession(req.params.id, `${DASHBOARD_URL}/clients/${req.params.id}`)
    res.json({ url })
  } catch (err) {
    console.error('[billing] portal error', err)
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to open billing portal' })
  }
})

// (Base-plan comp removed 2026-07-24 with Starter/Pro — assigning a tier via
// "Save tier" now grants that tier's entitlements without a charge.)

// Add or remove an add-on service on the client's existing subscription.
const addonSchema = z.object({
  serviceKey: z.enum(SERVICE_KEYS),
  action: z.enum(['add', 'remove'])
})

billingRouter.post('/:id/addons', async (req, res) => {
  const identity = getIdentity(req)
  if (!identity) return res.status(401).json({ error: 'Unauthorized' })
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  if (!billingConfigured()) return res.status(500).json({ error: 'Billing not configured' })

  const parsed = addonSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' })

  const service = serviceForKey(parsed.data.serviceKey)
  if (!service) return res.status(404).json({ error: 'Unknown service' })
  if (parsed.data.action === 'add' && service.status !== 'available') {
    return res.status(400).json({ error: 'This service is not available yet' })
  }

  try {
    if (parsed.data.action === 'add') await addServiceToSubscription(req.params.id, parsed.data.serviceKey)
    else await removeServiceFromSubscription(req.params.id, parsed.data.serviceKey)
    res.json({ ok: true, entitlements: await getEntitlements(req.params.id) })
  } catch (err) {
    console.error('[billing] addon error', err)
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update service' })
  }
})

// Superadmin-only: comp / un-comp an individual add-on service (no Stripe
// charge). Distinct from /:id/comp, which comps the whole base plan.
const serviceCompSchema = z.object({
  serviceKey: z.enum(SERVICE_KEYS),
  revoke: z.boolean().optional()
})

billingRouter.post('/:id/services/comp', async (req, res) => {
  const identity = getIdentity(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })

  const parsed = serviceCompSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' })

  const client = await getClientById(req.params.id)
  if (!client) return res.status(404).json({ error: 'Not found' })

  try {
    if (parsed.data.revoke) await revokeService(client.id, parsed.data.serviceKey)
    else await grantService(client.id, parsed.data.serviceKey, identity.userId)
    res.json({ ok: true, entitlements: await getEntitlements(client.id) })
  } catch (err) {
    console.error('[billing] service comp error', err)
    res.status(500).json({ error: 'Failed to update service grant' })
  }
})

// ── Paid Ads monthly fee reconciliation (superadmin) ────────────────────────
// The fee is "greater of the flat floor or % of ad spend." The floor bills
// automatically as the recurring `ads` add-on; this handles the % overage. GET
// previews the breakdown for a given month's spend; POST bills the overage as a
// one-off invoice item (idempotent per client+period, confirm-before-bill).
const adsFeeSchema = z.object({
  spendCents: z.number().int().nonnegative(),
  period: z.string().regex(/^\d{4}-\d{2}$/) // YYYY-MM
})

billingRouter.get('/:id/ads-fee', async (req, res) => {
  const identity = getIdentity(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  const client = await getClientById(req.params.id)
  if (!client) return res.status(404).json({ error: 'Not found' })
  const spendCents = Math.max(0, Number(req.query.spendCents) || 0)
  try {
    const floorCents = await getAdsFloorCents()
    res.json(computeAdsFee(spendCents, floorCents))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to compute fee' })
  }
})

billingRouter.post('/:id/ads-fee', async (req, res) => {
  const identity = getIdentity(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  if (!billingConfigured()) return res.status(500).json({ error: 'Billing not configured' })
  const client = await getClientById(req.params.id)
  if (!client) return res.status(404).json({ error: 'Not found' })
  const parsed = adsFeeSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' })
  try {
    const floorCents = await getAdsFloorCents()
    const result = await reconcileAdsFee(client.id, parsed.data.spendCents, floorCents, parsed.data.period)
    res.json(result)
  } catch (err) {
    console.error('[billing] ads-fee error', err)
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to bill overage' })
  }
})

// Current subscription + resolved plan info for a client.
billingRouter.get('/:id', async (req, res) => {
  const identity = getIdentity(req)
  if (!identity) return res.status(401).json({ error: 'Unauthorized' })
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })

  const sub = await getSubscription(req.params.id)
  res.json({ subscription: sub, plan: sub ? planForSubscription(sub.stripePriceId) : null })
})

// Stripe webhook — subscription lifecycle events. Mounted separately in
// index.ts with raw-body parsing (signature verification needs the exact
// bytes Stripe signed, which express.json() would already have consumed).
// NOT behind requireAuth: Stripe calls this directly, verified by signature.
export function stripeWebhookHandler(req: Request, res: Response): void {
  const sig = req.headers['stripe-signature']
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret || !sig) {
    res.status(500).send('Webhook not configured')
    return
  }

  let event
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, secret)
  } catch (err) {
    console.error('[billing] webhook signature verification failed', err)
    res.status(400).send('Invalid signature')
    return
  }

  switch (event.type) {
    case 'checkout.session.completed':
      // A tier Payment Link was paid — attribute the new subscription to the
      // client via the session's client_reference_id, then sync.
      void attributeCheckoutToClient(event.data.object)
      break
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      void syncSubscriptionFromStripe(event.data.object)
      break
    default:
      break // other events intentionally ignored
  }

  res.json({ received: true })
}
