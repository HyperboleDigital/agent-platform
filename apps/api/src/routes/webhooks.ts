import { Router } from 'express'
import type { Request, Response } from 'express'
import { relayClerkEmail } from '../lib/clerk-email-relay'

export const webhookRouter = Router()

// Generic webhook endpoint for n8n or external triggers
// Add new integrations here without touching other routes
webhookRouter.post('/:integration', async (req, res) => {
  const { integration } = req.params
  console.log(`[webhook] received from ${integration}`, req.body)
  // Route to the appropriate handler based on integration name
  // e.g. /webhooks/typeform, /webhooks/stripe, /webhooks/calendly
  res.json({ received: true, integration })
})

// Clerk webhook — relays any Clerk system email (org invitations, etc.) that
// has "Delivered by Clerk" turned off in the Clerk dashboard, sending it
// through our own platform Gmail instead of Clerk's SendGrid. Mounted
// separately in index.ts with raw-body parsing (Svix signature verification
// needs the exact bytes Clerk signed) and NOT behind requireAuth — Clerk
// calls this directly, verified by signature, same pattern as the Stripe
// webhook in routes/billing.ts.
export async function clerkWebhookHandler(req: Request, res: Response): Promise<void> {
  try {
    const status = await relayClerkEmail(req.body as Buffer, req.headers)
    // Always 200 on a handled request (even a no-op like "not for us" or
    // "already relayed") — a non-2xx tells Svix to retry, which is only
    // correct for a transient failure, not a legitimate skip.
    res.json({ status })
  } catch (err) {
    console.error('[clerk-relay] handler error', err)
    // A genuine unexpected failure SHOULD be retried.
    res.status(500).json({ error: 'Internal error' })
  }
}
