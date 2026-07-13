import { Router } from 'express'
import { getIdentity } from '../lib/authz'
import { getOverviewSummary, getClientRollups } from '../lib/overview'

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
