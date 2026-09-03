import { Router } from 'express'
import { z } from 'zod'
import { getClientById } from '../lib/clients'
import { logLead } from '../tools/crm'
import { notifyEscalation } from '../lib/escalation'
import { overLimit } from '../lib/rate-limit'
import { CONTACT_PER_HOUR } from '../lib/usage'
import { isOriginAllowed } from '@agent-platform/shared'

export const contactRouter = Router()

const contactSchema = z.object({
  clientId: z.string().uuid(),
  email: z.string().email().max(200),
  name: z.string().max(200).optional(),
  // Optional: clients whose widgetConfig.contactFields sets messageOptional
  // let visitors submit with just an email. An absent/empty message gets a
  // placeholder in the lead's summary (below), while Slack/email notifications
  // simply drop their "What they said" quote instead of quoting filler.
  message: z.string().max(4000).optional(),
  // Why they reached out (e.g. "Visitor requested a demo"), so the team's
  // notification reflects the real intent instead of a generic escalation.
  reason: z.string().max(200).optional(),
  // Only sent by clients whose widgetConfig.contactFields opts into asking
  // for these — optional here so every other client's form keeps working
  // unchanged.
  company: z.string().max(200).optional(),
  phone: z.string().max(50).optional(),
  division: z.string().max(200).optional()
})

// Widget contact form. This is an explicit "I want a human" signal — it does
// NOT run the agent. It logs the lead and notifies a human (Slack + email).
contactRouter.post('/', async (req, res) => {
  const parsed = contactSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' })
  const { clientId, email, name, message, reason, company, phone, division } = parsed.data

  // Throttle per client so a public clientId can't be used to flood the
  // client's Gmail/Slack with escalation spam.
  if (overLimit(`contact:${clientId}`, CONTACT_PER_HOUR, 60 * 60_000)) {
    return res.status(429).json({ error: 'Too many submissions — please try again later.' })
  }

  const client = await getClientById(clientId)
  if (!client) return res.status(404).json({ error: 'Unknown client' })

  // Domain lock — same reasoning as /chat. This endpoint writes a lead and
  // emails/Slacks a human, so an unauthorised embed here is a spam vector.
  if (!isOriginAllowed(req.get('origin'), client.widgetConfig?.allowedDomains)) {
    return res.status(403).json({ error: 'This form is not authorised for this domain.' })
  }

  try {
    await logLead({
      clientId, name, email,
      intent: reason ?? 'contact_form',
      summary: message || '(No additional message provided.)',
      company, phone, division
    })
    await notifyEscalation(client, {
      from: email,
      name,
      message: message ?? '',
      reason: reason ?? 'Visitor requested a human via the contact form',
      channel: 'contact_form',
      company,
      phone,
      division
    })
    res.json({ ok: true })
  } catch (err) {
    console.error('[contact] error', err)
    res.status(500).json({ error: 'Failed to submit' })
  }
})
