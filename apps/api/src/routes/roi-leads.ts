import { Router } from 'express'
import { z } from 'zod'
import { getClientBySlug } from '../lib/clients'
import { logLead } from '../tools/crm'
import { notifyEscalation } from '../lib/escalation'
import { overLimit } from '../lib/rate-limit'
import type { EmailRow } from '../lib/email-template'

// Public endpoint for the Spec-ID website's ROI calculator (Squarespace has no
// API we could push to, so the calculator POSTs here instead). Deliberately a
// thin adapter over the EXISTING lead pipeline: the lead lands in the same
// leads table the chatbot writes to (so it shows in the dashboard lead list
// unchanged) and the notification email goes out through the same
// notifyEscalation path, with the calculator numbers and the visitor's PDF
// added. The visitor already downloaded their PDF in-browser — nothing is
// ever emailed to them.
export const roiLeadsRouter = Router()

const SPEC_ID_SLUG = 'spec-id'
const ROI_PER_HOUR = 10
const MAX_PDF_BYTES = 2 * 1024 * 1024

const roiSchema = z.object({
  mode: z.string().max(50).optional(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  company: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(200),
  // Calculator numbers — kept loose (finite numbers by key) so a calculator
  // copy tweak on the website doesn't start bouncing leads with a 400.
  inputs: z.record(z.number().finite()).optional(),
  results: z.record(z.number().finite()).optional(),
  pdf: z.object({
    filename: z.string().trim().min(1).max(200),
    contentType: z.literal('application/pdf'),
    base64: z.string().min(1)
  })
})

// The visitor-facing numbers, formatted for the notification email and the
// lead's summary line. Unknown keys still show up (raw) so nothing entered on
// the calculator silently disappears from the notification.
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const INPUT_LABELS: Record<string, [string, (n: number) => string]> = {
  projects: ['Projects / year', n => String(n)],
  rate: ['PM hourly rate', n => `${usd(n)}/hr`],
  divisions: ['Divisions', n => String(n)],
  avgValue: ['Avg project value', usd]
}
const RESULT_LABELS: Record<string, [string, (n: number) => string]> = {
  hoursSaved: ['Hours saved / year', n => `${Math.round(n).toLocaleString('en-US')} hrs`],
  laborSaved: ['Labor saved / year', usd],
  breakEven: ['Break-even', n => `${n} projects`]
}

function formatRows(values: Record<string, number> | undefined, labels: Record<string, [string, (n: number) => string]>): EmailRow[] {
  return Object.entries(values ?? {}).map(([key, n]) => {
    const [label, fmt] = labels[key] ?? [key, (v: number) => String(v)]
    return { label, value: fmt(n) }
  })
}

// True client IP: the API sits behind Render's proxy and `trust proxy` isn't
// enabled app-wide, so req.ip would be the proxy. First XFF hop is the client.
function callerIp(header: unknown, fallback: string | undefined): string {
  const xff = typeof header === 'string' ? header.split(',')[0]?.trim() : undefined
  return xff || fallback || 'unknown'
}

roiLeadsRouter.post('/', async (req, res) => {
  const ip = callerIp(req.headers['x-forwarded-for'], req.socket.remoteAddress)
  if (overLimit(`roi:${ip}`, ROI_PER_HOUR, 60 * 60_000)) {
    return res.status(429).json({ error: 'Too many submissions — please try again later.' })
  }

  const parsed = roiSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' })
  const { firstName, lastName, company, email, inputs, results, pdf } = parsed.data

  // The PDF must actually BE base64 (Buffer.from silently drops garbage, so
  // decode → re-encode must round-trip) and decode to something PDF-sized.
  const normalized = pdf.base64.replace(/\s+/g, '')
  const bytes = Buffer.from(normalized, 'base64')
  if (bytes.length === 0 || bytes.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) {
    return res.status(400).json({ error: 'Invalid request' })
  }
  if (bytes.length > MAX_PDF_BYTES) return res.status(400).json({ error: 'PDF too large' })

  const client = await getClientBySlug(SPEC_ID_SLUG)
  if (!client) {
    console.error(`[roi-leads] client with slug "${SPEC_ID_SLUG}" not found`)
    return res.status(500).json({ error: 'Failed to submit' })
  }

  const name = `${firstName} ${lastName}`
  const detailRows = [...formatRows(inputs, INPUT_LABELS), ...formatRows(results, RESULT_LABELS)]
  const summary = detailRows.length
    ? `ROI calculator: ${detailRows.map(r => `${r.label}: ${r.value}`).join(' · ')}`
    : 'ROI calculator PDF download'

  try {
    await logLead({
      clientId: client.id,
      name,
      email,
      company,
      channel: 'roi-calculator',
      intent: 'roi-calculator',
      summary
    })
  } catch (err) {
    console.error('[roi-leads] lead insert failed', err)
    return res.status(500).json({ error: 'Failed to submit' })
  }

  // Lead is recorded — respond now; Slack + email notification is async and
  // best-effort (a Gmail hiccup must not read as a failed download to the
  // visitor's browser). The PDF only travels on the email, never to the DB.
  res.json({ ok: true })

  notifyEscalation(client, {
    from: email,
    name,
    company,
    message: '',
    reason: 'Downloaded their ROI summary from the website calculator',
    channel: 'roi-calculator',
    details: detailRows,
    attachments: [{ filename: pdf.filename, contentType: pdf.contentType, contentBase64: normalized }]
  }).catch(err => console.error('[roi-leads] notification failed', err))
})
