import { Router } from 'express'
import { z } from 'zod'
import { runAgent } from '../lib/orchestrator'
import { logMessage } from '../lib/logs'
import { overLimit } from '../lib/rate-limit'
import { checkChatCaps, CHAT_BURST_PER_MIN } from '../lib/usage'
import { billingConfigured, getSubscription, isActive } from '../lib/billing'
import type { IncomingMessage } from '@agent-platform/shared'

export const chatRouter = Router()

const chatSchema = z.object({
  clientId: z.string().uuid(),
  from: z.string().max(200),          // session id or email
  body: z.string().min(1).max(2000)
})

chatRouter.post('/', async (req, res) => {
  const parsed = chatSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' })

  const message: IncomingMessage = {
    ...parsed.data,
    channel: 'chat'
  }

  // Abuse controls, cheapest first, all BEFORE any paid LLM call.
  // 1. Per-client burst (in-memory) — stops a flood from one public clientId.
  if (overLimit(`chat:${message.clientId}`, CHAT_BURST_PER_MIN, 60_000)) {
    return res.status(429).json({ error: 'Too many messages — please slow down.' })
  }
  // 2. Subscription must be active (paid, trialing, or superadmin-comped) —
  // only enforced when this deployment has billing configured at all, so
  // local/dev without Stripe keys isn't locked out.
  if (billingConfigured() && !isActive(await getSubscription(message.clientId))) {
    return res.status(402).json({ error: 'This assistant is currently unavailable.' })
  }
  // 3. Per-client daily cap + global circuit breaker (DB-backed).
  const caps = await checkChatCaps(message.clientId)
  if (!caps.allowed) {
    if (caps.reason === 'global_daily_cap') console.warn('[chat] GLOBAL daily LLM cap hit — circuit breaker open')
    return res.status(429).json({ error: 'Daily message limit reached. Please try again later.' })
  }

  const startedAt = Date.now()
  try {
    const result = await runAgent(message)
    void logMessage({
      clientId: message.clientId,
      channel: 'chat',
      intent: result.intent,
      resolved: !result.escalate,
      durationMs: Date.now() - startedAt
    })
    res.json({ reply: result.reply, intent: result.intent, action: result.action })
  } catch (err) {
    console.error('[chat] agent error', err)
    res.status(500).json({ error: 'Agent error — escalating to human.' })
  }
})
