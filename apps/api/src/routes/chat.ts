import { Router } from 'express'
import { z } from 'zod'
import { runAgent } from '../lib/orchestrator'
import { logMessage } from '../lib/logs'
import { overLimit } from '../lib/rate-limit'
import { checkChatCaps, CHAT_BURST_PER_MIN } from '../lib/usage'
import { billingConfigured, getSubscription, isActive } from '../lib/billing'
import { getEntitlements } from '../lib/entitlements'
import { getClientById } from '../lib/clients'
import { isOriginAllowed } from '@agent-platform/shared'
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
  // 1b. Domain lock. Enforced here as well as on /widget-config because the
  // config fetch is skippable: a stolen script can hard-pin every setting via
  // data-* attributes and never call it. This is the check that actually
  // protects the paid LLM call.
  const originClient = await getClientById(message.clientId)
  if (!isOriginAllowed(req.get('origin'), originClient?.widgetConfig?.allowedDomains)) {
    return res.status(403).json({ error: 'This assistant is not authorised for this domain.' })
  }
  // 2. Access. Any ONE of these grants it:
  //   - an active Stripe base subscription (paid/trialing/past_due, or the
  //     legacy 'comped' rows from before base-plan comp was removed);
  //   - a chat entitlement — i.e. an assigned tier that includes chat (Growth)
  //     or a superadmin service grant. This is the comp path since 2026-07-24
  //     (see the note in lib/billing.ts); checking the raw subscription alone
  //     locked every tier-assigned-but-unpaid client out of chat with a 402
  //     the widget rendered as "trouble connecting";
  //   - chatUnmanaged — downgraded off a chat tier but keeping the assistant
  //     live (lib/tier-transitions.ts).
  // Only enforced when this deployment has billing configured at all, so
  // local/dev without Stripe keys isn't locked out.
  if (billingConfigured()) {
    const [sub, ent] = await Promise.all([getSubscription(message.clientId), getEntitlements(message.clientId)])
    const hasAccess = isActive(sub) || !!ent.services.chat?.entitled || !!originClient?.agentConfig?.chatUnmanaged
    if (!hasAccess) {
      console.warn(`[chat] 402 for client ${message.clientId} — no active subscription, chat tier/grant, or chatUnmanaged`)
      return res.status(402).json({ error: 'This assistant is currently unavailable.' })
    }
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
    const t = result.telemetry
    void logMessage({
      clientId: message.clientId,
      channel: 'chat',
      intent: result.intent,
      resolved: !result.escalate,
      durationMs: Date.now() - startedAt,
      sessionId: t?.sessionId,
      userMessage: t?.userMessage,
      assistantResponse: t?.assistantResponse,
      confidence: t?.confidence,
      escalated: t?.escalated,
      escalationReason: t?.escalationReason,
      resolvedBy: t?.resolvedBy,
      toolsUsed: t?.toolsUsed,
      retrievedDocIds: t?.retrievedDocIds,
      queryEmbedding: t?.queryEmbedding,
      model: t?.model,
      inputTokens: t?.inputTokens,
      outputTokens: t?.outputTokens,
      costMicros: t?.costMicros
    })
    res.json({ reply: result.reply, intent: result.intent, action: result.action, context: result.context })
  } catch (err) {
    console.error('[chat] agent error', err)
    res.status(500).json({ error: 'Agent error — escalating to human.' })
  }
})
