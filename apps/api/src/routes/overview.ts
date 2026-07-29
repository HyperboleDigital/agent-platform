import { Router } from 'express'
import { getIdentity } from '../lib/authz'
import { getOverviewSummary, getClientRollups } from '../lib/overview'
import { listOpenRequests, updateRequestStatus } from '../lib/change-requests'
import { startAdhocCrawl, refreshAdhocCrawl, listAdhocCrawls, crawlConfigured } from '../lib/dataforseo'

export const overviewRouter = Router()

// Platform-wide rollups across all clients — superadmin only, no per-client
// scoping applies (unlike clientsRouter, which gates on canAccessClient).
overviewRouter.use((req, res, next) => {
  const identity = getIdentity(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  next()
})

overviewRouter.get('/summary', async (_req, res) => {
  res.json(await getOverviewSummary())
})

overviewRouter.get('/clients', async (_req, res) => {
  res.json(await getClientRollups())
})

// Cross-client open/in_progress change request queue.
overviewRouter.get('/requests', async (_req, res) => {
  res.json(await listOpenRequests())
})

overviewRouter.patch('/requests/:clientId/:requestId', async (req, res) => {
  const status = req.body?.status
  if (typeof status !== 'string') return res.status(400).json({ error: 'status is required' })
  try {
    const identity = getIdentity(req)
    res.json(await updateRequestStatus(req.params.clientId, req.params.requestId, status as never, identity?.userId ?? null))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update status' })
  }
})

// ── Ad-hoc audit tool: crawl any URL on demand (superadmin, manual only) ──────
overviewRouter.get('/audits', async (_req, res) => {
  res.json(await listAdhocCrawls(20))
})

overviewRouter.post('/audits', async (req, res) => {
  const url = req.body?.url
  if (typeof url !== 'string' || !url.trim()) return res.status(400).json({ error: 'A URL is required' })
  if (!crawlConfigured()) return res.status(400).json({ error: 'Crawl auditing is not configured on this deployment' })
  try {
    res.json(await startAdhocCrawl(url))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to start audit' })
  }
})

overviewRouter.get('/audits/:crawlId', async (req, res) => {
  try {
    res.json(await refreshAdhocCrawl(req.params.crawlId))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to refresh audit' })
  }
})
