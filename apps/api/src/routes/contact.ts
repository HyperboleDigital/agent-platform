import { Router } from 'express'
import { z } from 'zod'
import { getClientById } from '../lib/clients'
import { logLead } from '../tools/crm'
import { notifyEscalation } from '../lib/escalation'
import { overLimit } from '../lib/rate-limit'
import { CONTACT_PER_HOUR } from '../lib/usage'

export const contactRouter = Router()

const contactSchema = z.object({
  clientId: z.string().uuid(),
  email: z.string().email().max(200),
  name: z.string().max(200).optional(),
  message: z.string().min(1).max(4000)
})

// Widget contact form. This is an explicit "I want a human" signal — it does
// NOT run the agent. It logs the lead and notifies a human (Slack + email).
contactRouter.post('/', async (req, res) => {
  const parsed = contactSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' })
  const { clientId, email, name, message } = parsed.data

  // Throttle per client so a public clientId can't be used to flood the
  // client's Gmail/Slack with escalation spam.
  if (overLimit(`contact:${clientId}`, CONTACT_PER_HOUR, 60 * 60_000)) {
    return res.status(429).json({ error: 'Too many submissions — please try again later.' })
  }

  const client = await getClientById(clientId)
  if (!client) return res.status(404).json({ error: 'Unknown client' })

  try {
    await logLead({ clientId, name, email, intent: 'contact_form', summary: message })
    await notifyEscalation(client, {
      from: email,
      name,
      message,
      reason: 'Visitor requested a human via the contact form',
      channel: 'contact_form'
    })
    res.json({ ok: true })
  } catch (err) {
    console.error('[contact] error', err)
    res.status(500).json({ error: 'Failed to submit' })
  }
})
