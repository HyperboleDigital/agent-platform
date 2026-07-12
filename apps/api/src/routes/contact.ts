import { Router } from 'express'
import { z } from 'zod'
import { getClientById } from '../lib/clients'
import { logLead } from '../tools/crm'
import { notifyEscalation } from '../lib/escalation'

export const contactRouter = Router()

const contactSchema = z.object({
  clientId: z.string().uuid(),
  email: z.string().email(),
  name: z.string().optional(),
  message: z.string().min(1).max(4000)
})

// Widget contact form. This is an explicit "I want a human" signal — it does
// NOT run the agent. It logs the lead and notifies a human (Slack + email).
contactRouter.post('/', async (req, res) => {
  const parsed = contactSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() })
  const { clientId, email, name, message } = parsed.data

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
