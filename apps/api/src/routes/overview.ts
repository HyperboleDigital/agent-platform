import { Router } from 'express'
import { getIdentity } from '../lib/authz'
import { getOverviewSummary, getClientRollups } from '../lib/overview'
import { getAiSpend } from '../lib/ai-spend'
import { listOpenRequests, updateRequestStatus } from '../lib/change-requests'
import { startAdhocCrawl, refreshAdhocCrawl, listAdhocCrawls, crawlConfigured } from '../lib/dataforseo'
import { listJobsOverview, runJobNow, reconcileAllClients, listJobTypes } from '../lib/scheduled-jobs'
import { gmailConfigured, getPlatformAuthUrl, checkPlatformGmailStatus, disconnectPlatformGmail } from '../lib/gmail'

export const overviewRouter = Router()

// Platform-wide rollups across all clients — superadmin only, no per-client
// scoping applies (unlike clientsRouter, which gates on canAccessClient).
overviewRouter.use((req, res, next) => {
  const identity = getIdentity(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  next()
})

// ── Scheduled jobs (handoff #2 §1) ──────────────────────────────────────────
// The operational backbone view: every client × every job they should have,
// with last run/status/next run, plus `missing` warnings for anything their
// entitlements promise that has no enabled job — the check that catches us
// promising something we aren't delivering.
overviewRouter.get('/jobs', async (_req, res) => {
  try {
    res.json(await listJobsOverview())
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to load jobs' })
  }
})

overviewRouter.get('/jobs/types', (_req, res) => {
  res.json(listJobTypes())
})

overviewRouter.post('/jobs/:id/run', async (req, res) => {
  try {
    res.json(await runJobNow(req.params.id))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Job run failed' })
  }
})

overviewRouter.post('/jobs/reconcile', async (_req, res) => {
  try {
    await reconcileAllClients()
    res.json(await listJobsOverview())
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Reconcile failed' })
  }
})

// Month-to-date AI/vendor spend recorded by the platform (chat + generation
// runs + paid SEO jobs). Superadmin via the router-level gate above.
overviewRouter.get('/ai-spend', async (_req, res) => {
  try {
    res.json(await getAiSpend())
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to compute AI spend' })
  }
})

overviewRouter.get('/summary', async (_req, res) => {
  res.json(await getOverviewSummary())
})

// ── Platform email sender ────────────────────────────────────────────────────
// The Gmail connection ALL platform-sent email uses (Clerk-relayed system
// emails, reports, change-request notifications) — never a client's own
// inbox. See lib/gmail.ts's platform_gmail_token functions and TODO.md for
// why this replaced borrowing a client's connection.
overviewRouter.get('/platform-gmail', async (_req, res) => {
  const gmail = gmailConfigured()
    ? await checkPlatformGmailStatus()
    : { connected: false, status: 'not_configured' as const }
  res.json({ configured: gmailConfigured(), ...gmail })
})

overviewRouter.get('/platform-gmail/auth-url', async (_req, res) => {
  if (!gmailConfigured()) return res.status(500).json({ error: 'Gmail OAuth not configured' })
  res.json({ url: getPlatformAuthUrl() })
})

overviewRouter.delete('/platform-gmail', async (_req, res) => {
  try {
    await disconnectPlatformGmail()
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to disconnect' })
  }
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
