import { Router } from 'express'
import type { Request } from 'express'
import multer from 'multer'
import { getAllClients, upsertClient, getClientById } from '../lib/clients'
import { addDocument, listDocuments } from '../tools/knowledge-base'
import { extractText, isSupportedFile, SUPPORTED_EXTENSIONS } from '../lib/file-extract'
import { getLeads } from '../tools/crm'
import { getStats, getDailyMessageCounts } from '../lib/logs'
import { getConnectorStatus } from '../lib/connectors'
import { gmailConfigured, getAuthUrl } from '../lib/gmail'
import { getMonthlyUsage } from '../lib/usage'
import { getEntitlements, isEntitled } from '../lib/entitlements'
import { runAudits, getAuditHistory } from '../lib/seo'
import { gscConfigured, fetchSearchAnalytics, getGscTrend, getContentOpportunities } from '../lib/gsc'
import { listQueries, addQuery, removeQuery, runVisibilityChecks, getRuns, getVisibilityTrend } from '../lib/visibility'
import { getIdentity, canAccessClient } from '../lib/authz'
import type { Identity } from '../lib/authz'

export const clientsRouter = Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB
})

// requireAuth (index.ts) already guarantees a signed-in identity by the time
// requests reach here — this is always non-null, but typed as such for safety.
function identityOf(req: Request): Identity {
  const identity = getIdentity(req)
  if (!identity) throw new Error('identityOf called without an authenticated request')
  return identity
}

// List clients this identity can see: all of them for superadmins, or just
// their own (0 or 1) for an org-scoped user.
clientsRouter.get('/', async (req, res) => {
  const identity = identityOf(req)
  const clients = await getAllClients()
  if (identity.isSuperadmin) return res.json(clients)
  res.json(clients.filter(c => c.clerkOrgId && c.clerkOrgId === identity.orgId))
})

clientsRouter.get('/:id', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  const client = await getClientById(req.params.id)
  if (!client) return res.status(404).json({ error: 'Not found' })
  res.json(client)
})

// Creating/renaming a client (tenant) is a superadmin action — org members
// don't get to mint new tenants or repoint clerkOrgId themselves.
clientsRouter.post('/', async (req, res) => {
  const identity = identityOf(req)
  const isUpdate = !!req.body?.id
  if (isUpdate) {
    if (!(await canAccessClient(identity, req.body.id))) return res.status(403).json({ error: 'Forbidden' })
    if (!identity.isSuperadmin) delete req.body.clerkOrgId // org members can't reassign tenant ownership
  } else if (!identity.isSuperadmin) {
    return res.status(403).json({ error: 'Only an admin can create a new client' })
  }
  try {
    const client = await upsertClient(req.body)
    res.json(client)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Request failed' })
  }
})

// Dashboard summary stats for a client
clientsRouter.get('/:id/stats', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  res.json(await getStats(req.params.id))
})

// Daily message counts for the trend chart (last N days, default 14)
clientsRouter.get('/:id/stats/timeseries', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 14))
  res.json(await getDailyMessageCounts(req.params.id, days))
})

// Conversations used this calendar month vs. the client's plan cap
clientsRouter.get('/:id/stats/usage', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  res.json(await getMonthlyUsage(req.params.id))
})

// Resolved service entitlements — drives the dashboard's locked sections.
clientsRouter.get('/:id/entitlements', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  res.json(await getEntitlements(req.params.id))
})

// Leads captured for a client
clientsRouter.get('/:id/leads', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  res.json(await getLeads(req.params.id))
})

// List knowledge base documents for a client
clientsRouter.get('/:id/knowledge', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  res.json(await listDocuments(req.params.id))
})

// Add a knowledge base document to a client
clientsRouter.post('/:id/knowledge', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  const { title, content, url } = req.body as { title: string; content: string; url?: string }
  if (!title || !content) return res.status(400).json({ error: 'title and content required' })
  const ids = await addDocument(req.params.id, title, content, url)
  res.json({ ids, chunks: ids.length })
})

// Upload a document file (PDF, Word, txt, md) to a client's knowledge base
clientsRouter.post('/:id/knowledge/upload', upload.single('file'), async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })

  const file = req.file
  if (!file) return res.status(400).json({ error: 'file required (multipart field "file")' })
  if (!isSupportedFile(file.originalname)) {
    return res.status(400).json({ error: `Unsupported file type. Allowed: ${SUPPORTED_EXTENSIONS.join(', ')}` })
  }

  try {
    const text = await extractText(file.originalname, file.buffer)
    if (!text.trim()) return res.status(400).json({ error: 'No extractable text found in file' })
    const ids = await addDocument(req.params.id, file.originalname, text)
    res.json({ ids, chunks: ids.length })
  } catch (err) {
    console.error('[knowledge upload] extraction error', err)
    res.status(400).json({ error: 'Failed to process file' })
  }
})

// Mints a Gmail OAuth consent URL for this client. Authenticated + authorized
// (only someone with dashboard access to this client can obtain a valid
// `state`), which is what makes the public /auth/gmail/callback safe — see
// the comment there. The dashboard opens the returned URL in a new tab/window
// rather than navigating a plain link, since that navigation can't carry a
// Bearer token.
clientsRouter.get('/:id/gmail/auth-url', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  if (!gmailConfigured()) return res.status(500).json({ error: 'Gmail OAuth not configured' })
  res.json({ url: getAuthUrl(req.params.id) })
})

// Connector status (Gmail, Slack, Calendly) for a client
clientsRouter.get('/:id/connectors', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  const client = await getClientById(req.params.id)
  if (!client) return res.status(404).json({ error: 'Not found' })
  res.json(await getConnectorStatus(req.params.id, client.agentConfig))
})

// ── SEO + AI visibility (the `seo` add-on service) ──────────────────────────

async function requireSeoAccess(req: Request, res: import('express').Response): Promise<string | null> {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) {
    res.status(403).json({ error: 'Forbidden' })
    return null
  }
  if (!(await isEntitled(req.params.id, 'seo'))) {
    res.status(403).json({ error: 'Not entitled', service: 'seo' })
    return null
  }
  return req.params.id
}

// PageSpeed Insights audit history for this client's configured pages.
clientsRouter.get('/:id/seo/audits', async (req, res) => {
  const id = await requireSeoAccess(req, res)
  if (!id) return
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 90))
  res.json(await getAuditHistory(id, days))
})

// Read/update the pages audited and brand terms tracked for this client.
clientsRouter.get('/:id/seo/config', async (req, res) => {
  const id = await requireSeoAccess(req, res)
  if (!id) return
  const client = await getClientById(id)
  res.json(client?.portalConfig ?? {})
})

clientsRouter.put('/:id/seo/config', async (req, res) => {
  const id = await requireSeoAccess(req, res)
  if (!id) return
  const client = await getClientById(id)
  if (!client) return res.status(404).json({ error: 'Not found' })
  const { seoPages, brandTerms, gscProperty } = req.body ?? {}
  const portalConfig = {
    ...client.portalConfig,
    ...(Array.isArray(seoPages) ? { seoPages } : {}),
    ...(Array.isArray(brandTerms) ? { brandTerms } : {}),
    ...(typeof gscProperty === 'string' ? { gscProperty } : {})
  }
  const updated = await upsertClient({ id, portalConfig })
  res.json(updated.portalConfig)
})

// Kicks off a fresh audit run (rate-limited to 1/hour/client inside runAudits).
clientsRouter.post('/:id/seo/audits', async (req, res) => {
  const id = await requireSeoAccess(req, res)
  if (!id) return
  try {
    res.json(await runAudits(id))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to run audit' })
  }
})

// Google Search Console — configured pages, ranking data, and trend.
clientsRouter.get('/:id/seo/rankings', async (req, res) => {
  const id = await requireSeoAccess(req, res)
  if (!id) return
  if (!gscConfigured()) return res.json({ connected: false })
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 28))
  const [trend, live] = await Promise.all([getGscTrend(id, days), fetchSearchAnalytics(id, days)])
  res.json({ connected: !!live, trend, latest: live })
})

clientsRouter.get('/:id/seo/opportunities', async (req, res) => {
  const id = await requireSeoAccess(req, res)
  if (!id) return
  res.json(await getContentOpportunities(id))
})

// AI-search (ChatGPT/Claude) visibility tracking.
clientsRouter.get('/:id/visibility/queries', async (req, res) => {
  const id = await requireSeoAccess(req, res)
  if (!id) return
  res.json(await listQueries(id))
})

clientsRouter.post('/:id/visibility/queries', async (req, res) => {
  const id = await requireSeoAccess(req, res)
  if (!id) return
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : ''
  if (!query) return res.status(400).json({ error: 'query is required' })
  try {
    res.json(await addQuery(id, query))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to add query' })
  }
})

clientsRouter.delete('/:id/visibility/queries/:queryId', async (req, res) => {
  const id = await requireSeoAccess(req, res)
  if (!id) return
  try {
    await removeQuery(id, req.params.queryId)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to remove query' })
  }
})

// Runs all active queries (or one, via ?queryId=) through OpenAI + Anthropic
// web search and records mention judgements.
clientsRouter.post('/:id/visibility/run', async (req, res) => {
  const id = await requireSeoAccess(req, res)
  if (!id) return
  try {
    const queryId = typeof req.body?.queryId === 'string' ? req.body.queryId : undefined
    res.json(await runVisibilityChecks(id, queryId))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to run visibility check' })
  }
})

clientsRouter.get('/:id/visibility/runs', async (req, res) => {
  const id = await requireSeoAccess(req, res)
  if (!id) return
  const days = Math.min(180, Math.max(1, Number(req.query.days) || 30))
  const [runs, trend] = await Promise.all([getRuns(id, days), getVisibilityTrend(id, days)])
  res.json({ runs, trend })
})
