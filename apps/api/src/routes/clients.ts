import { Router } from 'express'
import type { Request } from 'express'
import multer from 'multer'
import { getAllClients, upsertClient, getClientById } from '../lib/clients'
import { addDocument, listDocuments, deleteDocument, updateDocumentDescription } from '../tools/knowledge-base'
import { extractText, isSupportedFile, SUPPORTED_EXTENSIONS } from '../lib/file-extract'
import { getLeads, updateLeadStatus, deleteLead } from '../tools/crm'
import { getStats, getDailyMessageCounts } from '../lib/logs'
import { getConnectorStatus } from '../lib/connectors'
import { gmailConfigured, getAuthUrl, disconnectGmail } from '../lib/gmail'
import { getMonthlyUsage } from '../lib/usage'
import { getEntitlements, isEntitled } from '../lib/entitlements'
import { runAudits, getAuditHistory } from '../lib/seo'
import { startCrawl, refreshCrawl, getLatestCrawl, crawlConfigured } from '../lib/dataforseo'
import { createMetaFixRequest, createSchemaFixRequest, createLlmsTxtRequest } from '../lib/seo-fixes'
import { gscConfigured, fetchSearchAnalytics, getGscTrend, getContentOpportunities, snapshotGsc } from '../lib/gsc'
import { listQueries, addQuery, removeQuery, runVisibilityChecks, getRuns, getVisibilityTrend } from '../lib/visibility'
import {
  listRequests, createRequest, updateRequestStatus, cancelRequest, getRequestDetail, addComment
} from '../lib/change-requests'
import { listAttachments, uploadAttachment, getAttachment, getSignedUrl } from '../lib/attachments'
import {
  listKnowledgeFiles, uploadKnowledgeFile, getKnowledgeFile, getSignedUrl as getKnowledgeFileSignedUrl
} from '../lib/knowledge-files'
import { getNotificationSettings, updateNotificationSettings } from '../lib/notify'
import { listPosts, getPost, draftPost, updatePost, transitionPost, setFramerItemId, type PostStatus } from '../lib/content'
import {
  getFramerConnection, saveFramerConnection, deleteFramerConnection, listCollectionFields, publishToFramer
} from '../lib/framer'
import { listReports, getReport, buildReport, sendReport } from '../lib/reports'
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
    if (!identity.isSuperadmin) {
      delete req.body.clerkOrgId // org members can't reassign tenant ownership
      delete req.body.name       // renaming a client is a superadmin action
    }
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

// Mark a lead as followed up (or back to new) — any authorized user for
// this client, not just a superadmin.
clientsRouter.patch('/:id/leads/:leadId', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  const status = req.body?.status
  if (typeof status !== 'string') return res.status(400).json({ error: 'status is required' })
  try {
    res.json(await updateLeadStatus(req.params.id, req.params.leadId, status as never))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update lead' })
  }
})

// Deleting a lead outright is superadmin-only — clients only get the
// followed-up toggle above, by design.
clientsRouter.delete('/:id/leads/:leadId', async (req, res) => {
  const identity = identityOf(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  try {
    await deleteLead(req.params.id, req.params.leadId)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete lead' })
  }
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
  const { title, content, url, description } = req.body as { title: string; content: string; url?: string; description?: string }
  if (!title || !content) return res.status(400).json({ error: 'title and content required' })
  const { documentId, ids } = await addDocument(req.params.id, title, content, { url, description })
  res.json({ documentId, ids, chunks: ids.length })
})

// Upload a document file to a client's knowledge base
clientsRouter.post('/:id/knowledge/upload', upload.single('file'), async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })

  const file = req.file
  if (!file) return res.status(400).json({ error: 'file required (multipart field "file")' })
  if (!isSupportedFile(file.originalname)) {
    return res.status(400).json({ error: `Unsupported file type. Allowed: ${SUPPORTED_EXTENSIONS.join(', ')}` })
  }
  const description = typeof req.body?.description === 'string' ? req.body.description : undefined

  try {
    const text = await extractText(file.originalname, file.buffer)
    if (!text.trim()) return res.status(400).json({ error: 'No extractable text found in file' })

    // Keep the original bytes too (knowledge_base only has extracted text) so
    // the dashboard can show a Drive-style preview thumbnail, and so the
    // document can later be deleted/replaced as a whole file. Best-effort —
    // a storage hiccup here shouldn't block the document from being searchable.
    let fileId: string | undefined
    try {
      const knowledgeFile = await uploadKnowledgeFile(req.params.id, file.originalname, file.mimetype, file.buffer, identity.userId)
      fileId = knowledgeFile.id
    } catch (fileErr) {
      console.error('[knowledge upload] failed to store original file', fileErr)
    }

    const { documentId, ids } = await addDocument(req.params.id, file.originalname, text, { fileId, description })
    res.json({ documentId, ids, chunks: ids.length })
  } catch (err) {
    console.error('[knowledge upload] extraction error', err)
    res.status(400).json({ error: 'Failed to process file' })
  }
})

// Delete a whole document (all its chunks, plus its original file if any).
clientsRouter.delete('/:id/knowledge/:documentId', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  try {
    await deleteDocument(req.params.id, req.params.documentId)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete document' })
  }
})

// Edit a document's description — the only field editable after the fact.
clientsRouter.patch('/:id/knowledge/:documentId', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  const description = typeof req.body?.description === 'string' ? req.body.description : ''
  try {
    await updateDocumentDescription(req.params.id, req.params.documentId, description)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update description' })
  }
})

// List uploaded knowledge files (for preview thumbnails) — separate from the
// chunked text rows in /knowledge, which are for search, not display.
clientsRouter.get('/:id/knowledge/files', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  res.json(await listKnowledgeFiles(req.params.id))
})

// Short-lived signed URL for previewing/downloading a knowledge file —
// minted fresh per request, same pattern as request attachments.
clientsRouter.get('/:id/knowledge/files/:fileId/url', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  const file = await getKnowledgeFile(req.params.fileId)
  if (!file || file.clientId !== req.params.id) return res.status(404).json({ error: 'File not found' })
  try {
    res.json({ url: await getKnowledgeFileSignedUrl(file.storagePath) })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to mint signed URL' })
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

// Disconnect the client's Gmail account — escalations fall back to
// Slack-only until reconnected (or a different account is connected).
clientsRouter.delete('/:id/gmail', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  try {
    await disconnectGmail(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to disconnect Gmail' })
  }
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

// Manually persist today's GSC snapshot for the trend chart. There's no
// scheduler yet (see TODO.md), so without this the trend chart can never
// populate — click-driven snapshots are the stand-in until one exists.
clientsRouter.post('/:id/seo/rankings/snapshot', async (req, res) => {
  const id = await requireSeoAccess(req, res)
  if (!id) return
  if (!gscConfigured()) return res.status(400).json({ error: 'Search Console is not configured on this deployment' })
  try {
    await snapshotGsc(id)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to snapshot rankings' })
  }
})

// ── DataForSEO On-Page crawl audit (SEO-automation plan, Phase 0) ─────────────
// Superadmin-only beta: costs real money per run (~$0.002/page), so it's gated
// off the client-facing funnel until the pipeline is proven. The crawl runs
// async on DataForSEO; the dashboard polls GET /seo/crawl/:crawlId to finalize.
clientsRouter.post('/:id/seo/crawl', async (req, res) => {
  const identity = identityOf(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  const id = await requireSeoAccess(req, res)
  if (!id) return
  if (!crawlConfigured()) return res.status(400).json({ error: 'Crawl auditing is not configured on this deployment' })
  try {
    res.json(await startCrawl(id))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to start crawl' })
  }
})

// Read-only latest crawl — visible to any entitled seo client (Part A). Running
// crawls + generating fixes stay superadmin-only (they spend money/tokens).
clientsRouter.get('/:id/seo/crawl', async (req, res) => {
  const id = await requireSeoAccess(req, res)
  if (!id) return
  res.json(await getLatestCrawl(id))
})

clientsRouter.get('/:id/seo/crawl/:crawlId', async (req, res) => {
  const identity = identityOf(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  const id = await requireSeoAccess(req, res)
  if (!id) return
  try {
    res.json(await refreshCrawl(id, req.params.crawlId))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to refresh crawl' })
  }
})

// Generate title/meta-description fixes from a finished crawl and deliver them
// as a one-click change request (Phase 2). Superadmin-only beta.
clientsRouter.post('/:id/seo/crawl/:crawlId/fix/meta', async (req, res) => {
  const identity = identityOf(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  const id = await requireSeoAccess(req, res)
  if (!id) return
  try {
    const { request, count } = await createMetaFixRequest(id, req.params.crawlId, identity.userId)
    res.json({ requestId: request.id, count })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to generate fix' })
  }
})

// Generate schema.org JSON-LD for the client's key pages, delivered as a change
// request (Phase 2, fix type 2). Not crawl-scoped — operates on configured pages.
clientsRouter.post('/:id/seo/fix/schema', async (req, res) => {
  const identity = identityOf(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  const id = await requireSeoAccess(req, res)
  if (!id) return
  try {
    const { request, count } = await createSchemaFixRequest(id, identity.userId)
    res.json({ requestId: request.id, count })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to generate schema' })
  }
})

// Generate an llms.txt file (GEO) for the client, delivered as a change request.
clientsRouter.post('/:id/seo/fix/llms', async (req, res) => {
  const identity = identityOf(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  const id = await requireSeoAccess(req, res)
  if (!id) return
  try {
    const { request, count } = await createLlmsTxtRequest(id, identity.userId)
    res.json({ requestId: request.id, count })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to generate llms.txt' })
  }
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

// ── Change requests ──────────────────────────────────────────────────────────
// Free with any active base subscription (not gated behind an add-on).

clientsRouter.get('/:id/requests', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  res.json(await listRequests(req.params.id))
})

clientsRouter.post('/:id/requests', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : ''
  const description = typeof req.body?.description === 'string' ? req.body.description.trim() : ''
  if (!title) return res.status(400).json({ error: 'title is required' })
  try {
    res.json(await createRequest(req.params.id, title, description, identity.userId))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create request' })
  }
})

// Status transitions are a superadmin call (they own the fulfillment work).
clientsRouter.patch('/:id/requests/:reqId', async (req, res) => {
  const identity = identityOf(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  const status = req.body?.status
  if (typeof status !== 'string') return res.status(400).json({ error: 'status is required' })
  try {
    res.json(await updateRequestStatus(req.params.id, req.params.reqId, status as never, identity.userId))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update status' })
  }
})

// Full detail (events + comments) backing the expandable row in the dashboard.
clientsRouter.get('/:id/requests/:reqId', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  const [detail, attachments] = await Promise.all([
    getRequestDetail(req.params.id, req.params.reqId),
    listAttachments(req.params.reqId)
  ])
  if (!detail) return res.status(404).json({ error: 'Request not found' })
  res.json({ ...detail, attachments })
})

// Client-initiated cancel — a required reason, only while still open/in_progress.
clientsRouter.post('/:id/requests/:reqId/cancel', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : ''
  if (!reason) return res.status(400).json({ error: 'reason is required' })
  try {
    res.json(await cancelRequest(req.params.id, req.params.reqId, identity.userId, reason))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to cancel request' })
  }
})

// Either party (client or superadmin) can comment on a request.
clientsRouter.post('/:id/requests/:reqId/comments', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : ''
  if (!body) return res.status(400).json({ error: 'body is required' })
  try {
    res.json(await addComment(req.params.reqId, identity.userId, !!identity.isSuperadmin, body))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to add comment' })
  }
})

// Attach a file to a request — on submit or any time after, per either party.
clientsRouter.post('/:id/requests/:reqId/attachments', upload.single('file'), async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  const file = req.file
  if (!file) return res.status(400).json({ error: 'file required (multipart field "file")' })
  try {
    const attachment = await uploadAttachment(req.params.reqId, file.originalname, file.mimetype, file.buffer, identity.userId)
    res.json(attachment)
  } catch (err) {
    console.error('[attachments] upload error', err)
    res.status(500).json({ error: 'Failed to upload attachment' })
  }
})

// Short-lived signed URL for previewing/downloading an attachment on demand
// — never returned embedded in the list response, minted fresh per request.
clientsRouter.get('/:id/requests/:reqId/attachments/:attachmentId/url', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  const attachment = await getAttachment(req.params.attachmentId)
  if (!attachment || attachment.requestId !== req.params.reqId) return res.status(404).json({ error: 'Attachment not found' })
  try {
    res.json({ url: await getSignedUrl(attachment.storagePath) })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to mint signed URL' })
  }
})

// ── Notification settings ────────────────────────────────────────────────────

clientsRouter.get('/:id/notification-settings', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  res.json(await getNotificationSettings(req.params.id))
})

clientsRouter.put('/:id/notification-settings', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  const { emailEnabled, emailTo, slackEnabled, slackWebhookUrl, events } = req.body ?? {}
  try {
    const updated = await updateNotificationSettings(req.params.id, {
      ...(typeof emailEnabled === 'boolean' ? { email_enabled: emailEnabled } : {}),
      ...(typeof emailTo === 'string' ? { email_to: emailTo } : {}),
      ...(typeof slackEnabled === 'boolean' ? { slack_enabled: slackEnabled } : {}),
      ...(typeof slackWebhookUrl === 'string' ? { slack_webhook_url: slackWebhookUrl } : {}),
      ...(events && typeof events === 'object' ? { events } : {})
    })
    res.json(updated)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update settings' })
  }
})

// ── Content engine (the `content` add-on service) ───────────────────────────

async function requireContentAccess(req: Request, res: import('express').Response): Promise<string | null> {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) {
    res.status(403).json({ error: 'Forbidden' })
    return null
  }
  if (!(await isEntitled(req.params.id, 'content'))) {
    res.status(403).json({ error: 'Not entitled', service: 'content' })
    return null
  }
  return req.params.id
}

clientsRouter.get('/:id/posts', async (req, res) => {
  const id = await requireContentAccess(req, res)
  if (!id) return
  res.json(await listPosts(id))
})

clientsRouter.post('/:id/posts/generate', async (req, res) => {
  const id = await requireContentAccess(req, res)
  if (!id) return
  const brief = typeof req.body?.brief === 'string' ? req.body.brief.trim() : ''
  const targetKeyword = typeof req.body?.targetKeyword === 'string' ? req.body.targetKeyword.trim() : ''
  try {
    res.json(await draftPost(id, brief, targetKeyword))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to generate post' })
  }
})

clientsRouter.patch('/:id/posts/:postId', async (req, res) => {
  const id = await requireContentAccess(req, res)
  if (!id) return
  const { title, slug, metaDescription, contentMd, brief, targetKeyword, status } = req.body ?? {}
  try {
    if (typeof status === 'string') {
      return res.json(await transitionPost(id, req.params.postId, status as PostStatus))
    }
    res.json(await updatePost(id, req.params.postId, {
      ...(typeof title === 'string' ? { title } : {}),
      ...(typeof slug === 'string' ? { slug } : {}),
      ...(typeof metaDescription === 'string' ? { metaDescription } : {}),
      ...(typeof contentMd === 'string' ? { contentMd } : {}),
      ...(typeof brief === 'string' ? { brief } : {}),
      ...(typeof targetKeyword === 'string' ? { targetKeyword } : {})
    }))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update post' })
  }
})

clientsRouter.post('/:id/posts/:postId/publish', async (req, res) => {
  const id = await requireContentAccess(req, res)
  if (!id) return
  const post = await getPost(id, req.params.postId)
  if (!post) return res.status(404).json({ error: 'Post not found' })
  if (post.status !== 'approved') return res.status(400).json({ error: 'Only an approved post can be published' })
  if (!post.title || !post.slug || !post.metaDescription || !post.contentMd) {
    return res.status(400).json({ error: 'Post is missing required content' })
  }
  try {
    const result = await publishToFramer(id, {
      id: post.id, title: post.title, slug: post.slug, metaDescription: post.metaDescription,
      contentMd: post.contentMd, framerItemId: post.framerItemId
    })
    // Store the Framer item ID before transitioning, so a retry after a
    // status-transition failure updates the same CMS item instead of
    // creating a duplicate.
    await setFramerItemId(id, post.id, result.itemId)
    const published = await transitionPost(id, post.id, 'published')
    res.json(published)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to publish to Framer' })
  }
})

clientsRouter.get('/:id/posts/:postId/export', async (req, res) => {
  const id = await requireContentAccess(req, res)
  if (!id) return
  const post = await getPost(id, req.params.postId)
  if (!post) return res.status(404).json({ error: 'Post not found' })
  const body = `# ${post.title ?? 'Untitled'}\n\n${post.contentMd ?? ''}`
  res.setHeader('Content-Type', 'text/markdown')
  res.setHeader('Content-Disposition', `attachment; filename="${post.slug || post.id}.md"`)
  res.send(body)
})

clientsRouter.get('/:id/framer-connection', async (req, res) => {
  const id = await requireContentAccess(req, res)
  if (!id) return
  res.json(await getFramerConnection(id))
})

clientsRouter.put('/:id/framer-connection', async (req, res) => {
  const id = await requireContentAccess(req, res)
  if (!id) return
  const { projectUrl, apiKey, collectionId, fieldMapping } = req.body ?? {}
  if (typeof projectUrl !== 'string' || typeof collectionId !== 'string') {
    return res.status(400).json({ error: 'projectUrl and collectionId are required' })
  }
  try {
    res.json(await saveFramerConnection(id, projectUrl, typeof apiKey === 'string' && apiKey ? apiKey : undefined, collectionId, fieldMapping ?? {}))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to save Framer connection' })
  }
})

clientsRouter.delete('/:id/framer-connection', async (req, res) => {
  const id = await requireContentAccess(req, res)
  if (!id) return
  await deleteFramerConnection(id)
  res.json({ ok: true })
})

clientsRouter.get('/:id/framer-connection/fields', async (req, res) => {
  const id = await requireContentAccess(req, res)
  if (!id) return
  try {
    res.json(await listCollectionFields(id))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to load Framer collection fields' })
  }
})

// ── Client reports ───────────────────────────────────────────────────────────
// Reports are available to any client with dashboard access (not gated behind
// an add-on). Generation and viewing are open to the client; SENDING email is
// superadmin-only in v1 (deliberate, guardrailed — see lib/reports.ts).

clientsRouter.get('/:id/reports', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  res.json(await listReports(req.params.id))
})

clientsRouter.post('/:id/reports/generate', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  const { periodStart, periodEnd } = req.body ?? {}
  try {
    res.json(await buildReport(
      req.params.id,
      typeof periodStart === 'string' ? periodStart : undefined,
      typeof periodEnd === 'string' ? periodEnd : undefined
    ))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to generate report' })
  }
})

clientsRouter.get('/:id/reports/:reportId', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  const report = await getReport(req.params.id, req.params.reportId)
  if (!report) return res.status(404).json({ error: 'Not found' })
  res.json(report)
})

// Manual email send — superadmin only, recipient explicit in the body.
clientsRouter.post('/:id/reports/:reportId/send', async (req, res) => {
  const identity = identityOf(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  const to = typeof req.body?.to === 'string' ? req.body.to : ''
  if (!to.trim()) return res.status(400).json({ error: 'A recipient (to) is required' })
  try {
    res.json(await sendReport(req.params.id, req.params.reportId, to))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to send report' })
  }
})
