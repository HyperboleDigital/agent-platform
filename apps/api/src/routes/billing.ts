import { Router } from 'express'
import { z } from 'zod'
import type { Request, Response } from 'express'
import { getClientById } from '../lib/clients'
import { getIdentity, canAccessClient } from '../lib/authz'
import {
  stripe, billingConfigured, listPlans, planForPriceId,
  getSubscription, createCheckoutSession, createPortalSession, syncSubscriptionFromStripe, compClient
} from '../lib/billing'

export const billingRouter = Router()

const DASHBOARD_URL = process.env.DASHBOARD_URL ?? 'http://localhost:5173'

// Available plans (id -> name/cap), for the dashboard's pricing UI.
billingRouter.get('/plans', (_req, res) => {
  res.json(listPlans())
})

const checkoutSchema = z.object({ priceId: z.string().min(1) })

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
      `${DASHBOARD_URL}/clients/${client.id}?billing=cancelled`
    )
    res.json({ url })
  } catch (err) {
    console.error('[billing] checkout error', err)
    res.status(500).json({ error: 'Failed to start checkout' })
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

// Superadmin-only: grant a client access without a real Stripe subscription
// (internal test clients, friends & family). A later real checkout simply
// overwrites this via the webhook.
const compSchema = z.object({ plan: z.enum(['starter', 'pro']).default('pro') })

billingRouter.post('/:id/comp', async (req, res) => {
  const identity = getIdentity(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })

  const parsed = compSchema.safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' })

  const client = await getClientById(req.params.id)
  if (!client) return res.status(404).json({ error: 'Not found' })

  try {
    await compClient(client.id, parsed.data.plan)
    res.json({ ok: true })
  } catch (err) {
    console.error('[billing] comp error', err)
    res.status(500).json({ error: 'Failed to comp client' })
  }
})

// Current subscription + resolved plan info for a client.
billingRouter.get('/:id', async (req, res) => {
  const identity = getIdentity(req)
  if (!identity) return res.status(401).json({ error: 'Unauthorized' })
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })

  const sub = await getSubscription(req.params.id)
  res.json({ subscription: sub, plan: sub ? planForPriceId(sub.stripePriceId) : null })
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
