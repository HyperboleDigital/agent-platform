import { Router } from 'express'
import { z } from 'zod'
import { runAgent } from '../lib/orchestrator'
import { logMessage } from '../lib/logs'
import type { IncomingMessage } from '@agent-platform/shared'

export const chatRouter = Router()

const chatSchema = z.object({
  clientId: z.string().uuid(),
  from: z.string(),        // session ID or user email
  body: z.string().min(1).max(2000)
})

chatRouter.post('/', async (req, res) => {
  const parsed = chatSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })

  const message: IncomingMessage = {
    ...parsed.data,
    channel: 'chat'
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
