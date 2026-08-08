import { Router } from 'express'
import type { Request, Response } from 'express'
import { getIdentity, canAccessClient } from '../lib/authz'
import {
  getHeadline, getTimeseries, getTopQuestions, getUnanswered, getCoverage, getTranscriptCsv,
  type DateRange
} from '../lib/analytics'

// Client-facing chat analytics. Mounted at /clients/:id/analytics with
// mergeParams so req.params.id resolves. Every handler re-checks
// canAccessClient — this router is behind requireAuth (index.ts) but that only
// proves *a* signed-in user, not that they own THIS client. The tenant check is
// the load-bearing one; do not remove it.
export const analyticsRouter = Router({ mergeParams: true })

const DAY_MS = 24 * 60 * 60 * 1000

// ?from=ISO&to=ISO for a custom range, else ?range=7|30|90 (days, default 30).
function parseRange(req: Request): DateRange {
  const now = new Date()
  const { from, to } = req.query
  if (typeof from === 'string' && typeof to === 'string') {
    const f = new Date(from), t = new Date(to)
    if (!isNaN(f.getTime()) && !isNaN(t.getTime()) && f <= t) return { from: f, to: t }
  }
  const days = Math.min(365, Math.max(1, Number(req.query.range) || 30))
  // Start at midnight UTC (days-1) ago so the trend chart shows exactly `days`
  // day-buckets ending today.
  const startDay = new Date(now.getTime() - (days - 1) * DAY_MS)
  const fromDate = new Date(Date.UTC(startDay.getUTCFullYear(), startDay.getUTCMonth(), startDay.getUTCDate()))
  return { from: fromDate, to: now }
}

// Guard shared by every handler. Returns the clientId when allowed, or null
// after having already sent the 403 response.
async function authorize(req: Request, res: Response): Promise<string | null> {
  const identity = getIdentity(req)
  const clientId = req.params.id
  if (!identity || !(await canAccessClient(identity, clientId))) {
    res.status(403).json({ error: 'Forbidden' })
    return null
  }
  return clientId
}

analyticsRouter.get('/headline', async (req, res) => {
  const clientId = await authorize(req, res); if (!clientId) return
  res.json(await getHeadline(clientId, parseRange(req)))
})

analyticsRouter.get('/timeseries', async (req, res) => {
  const clientId = await authorize(req, res); if (!clientId) return
  res.json(await getTimeseries(clientId, parseRange(req)))
})

analyticsRouter.get('/top-questions', async (req, res) => {
  const clientId = await authorize(req, res); if (!clientId) return
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20))
  res.json(await getTopQuestions(clientId, parseRange(req), limit))
})

analyticsRouter.get('/unanswered', async (req, res) => {
  const clientId = await authorize(req, res); if (!clientId) return
  res.json(await getUnanswered(clientId, parseRange(req)))
})

analyticsRouter.get('/coverage', async (req, res) => {
  const clientId = await authorize(req, res); if (!clientId) return
  res.json(await getCoverage(clientId, parseRange(req)))
})

// Transcript CSV export for a date range. Streams as a download.
analyticsRouter.get('/transcript.csv', async (req, res) => {
  const clientId = await authorize(req, res); if (!clientId) return
  try {
    const csv = await getTranscriptCsv(clientId, parseRange(req))
    const stamp = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="transcript-${stamp}.csv"`)
    res.send(csv)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to export transcript' })
  }
})
