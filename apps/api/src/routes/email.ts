import { Router } from 'express'
import { runAgent } from '../lib/orchestrator'
import type { IncomingMessage } from '@agent-platform/shared'

export const emailRouter = Router()

// Called by Gmail webhook / n8n when a new email arrives in the support inbox
emailRouter.post('/inbound', async (req, res) => {
  const { clientId, from, subject, body, threadId } = req.body as {
    clientId: string
    from: string
    subject: string
    body: string
    threadId?: string
  }

  if (!clientId || !from || !body) return res.status(400).json({ error: 'Missing fields' })

  const message: IncomingMessage = {
    clientId,
    channel: 'email',
    from,
    body: `Subject: ${subject}\n\n${body}`,
    threadId
  }

  try {
    const result = await runAgent(message)
    // Return result to n8n — n8n handles the actual Gmail reply
    res.json({ reply: result.reply, action: result.action, escalate: result.escalate, confidence: result.confidence })
  } catch (err) {
    console.error('[email] agent error', err)
    res.status(500).json({ error: 'Agent error' })
  }
})
