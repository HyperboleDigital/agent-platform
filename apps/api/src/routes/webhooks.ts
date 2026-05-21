import { Router } from 'express'

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
