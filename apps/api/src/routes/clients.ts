import { Router } from 'express'
import type { Request } from 'express'
import multer from 'multer'
import { getAllClients, upsertClient, getClientById, inviteClientUser, deleteClient } from '../lib/clients'
import { addDocument, listDocuments, deleteDocument, updateDocumentDescription } from '../tools/knowledge-base'
import { extractText, isSupportedFile, SUPPORTED_EXTENSIONS } from '../lib/file-extract'
import { uploadLogo, deleteLogo, ALLOWED_LOGO_TYPES, MAX_LOGO_BYTES } from '../lib/widget-logo'
import { getLeads, updateLeadStatus, deleteLead } from '../tools/crm'
import { getStats, getDailyMessageCounts } from '../lib/logs'
import { getConnectorStatus } from '../lib/connectors'
import { gmailConfigured, getAuthUrl, disconnectGmail } from '../lib/gmail'
import { getMonthlyUsage } from '../lib/usage'
import { getEntitlements, isEntitled } from '../lib/entitlements'
import { startCrawl, refreshCrawl, cancelCrawl, getLatestCrawl, getCrawlTrend, crawlConfigured, checkMapPackRank, researchKeywords } from '../lib/dataforseo'
import { fetchPlaceSummary, placesConfigured, searchBusinesses } from '../lib/places'
import { listTargetKeywords, addTargetKeyword, removeTargetKeyword, checkKeywordRanks } from '../lib/seo-keywords'
import { createMetaFixRequest, createSchemaFixRequest, createLlmsTxtRequest } from '../lib/seo-fixes'
import { gscConfigured, fetchSearchAnalytics, getGscTrend, getContentOpportunities, snapshotGsc } from '../lib/gsc'
import { googleAdsConfigured, fetchAdsPerformance, getAdsTrend, snapshotAds, getConnectedCustomerId } from '../lib/google-ads'
import { listQueries, addQuery, removeQuery, runVisibilityChecks, getRuns, getVisibilityTrend } from '../lib/visibility'
import {
  listRequests, createRequest, updateRequestStatus, cancelRequest, getRequestDetail, addComment, deleteRequest
} from '../lib/change-requests'
import { getMentionableUsers, getUserEmail } from '../lib/users'
import { listAttachments, uploadAttachment, getAttachment, getSignedUrl } from '../lib/attachments'
import {
  listKnowledgeFiles, uploadKnowledgeFile, getKnowledgeFile, getSignedUrl as getKnowledgeFileSignedUrl
} from '../lib/knowledge-files'
import { getNotificationSettings, updateNotificationSettings, sendGuardedEmail } from '../lib/notify'
import { listPosts, getPost, draftPost, updatePost, transitionPost, setFramerItemId, type PostStatus } from '../lib/content'
import {
  getFramerConnection, saveFramerConnection, deleteFramerConnection, listCollectionFields, publishToFramer
} from '../lib/framer'
import { listReports, getReport, buildReport, sendReport, deleteReport } from '../lib/reports'
import { latestBaseline, runSiteBaseline, pagespeedConfigured } from '../lib/site-baseline'
import { deliverMonthlyReport, previousPeriodKey } from '../lib/report-scheduler'
import {
  getTeam, inviteMember, revokeInvitation, removeMember, updateMemberRole, isTeamRole, TeamError
} from '../lib/team'
import { getIdentity, canAccessClient, canManageTeam } from '../lib/authz'
import type { Identity } from '../lib/authz'
import { getLatestSiteHealth, recordSiteHealthCheck } from '../lib/site-health'
import {
  listCitations, upsertCitation, deleteCitation, seedStandardDirectories, summarizeCitations,
  listGbpActivity, addGbpActivity, deleteGbpActivity, postsThisMonth
} from '../lib/local-presence'

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
      delete req.body.vertical   // pricing-sheet tier assignment is a superadmin (billing) action
      delete req.body.tierKey
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

// Superadmin-only: permanently delete a client and all its data. Guarded by an
// explicit typed confirmation (the client's exact name) in the request body so
// an accidental call can't wipe a tenant.
clientsRouter.delete('/:id', async (req, res) => {
  const identity = identityOf(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  const client = await getClientById(req.params.id)
  if (!client) return res.status(404).json({ error: 'Not found' })
  const confirmName = typeof req.body?.confirmName === 'string' ? req.body.confirmName.trim() : ''
  if (confirmName !== client.name) {
    return res.status(400).json({ error: 'Confirmation name does not match' })
  }
  try {
    await deleteClient(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    console.error('[clients] delete error', err)
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete client' })
  }
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Superadmin-only: create the client's Clerk Organization (if needed) and send
// a real Clerk invitation email so they can set their own password and log in.
// Never fires automatically — always an explicit click from the dashboard.
clientsRouter.post('/:id/invite', async (req, res) => {
  const identity = identityOf(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : ''
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'A valid email is required' })
  try {
    const result = await inviteClientUser(req.params.id, email)
    res.json({ ok: true, ...result })
  } catch (err) {
    console.error('[clients] invite error', err)
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to send invite' })
  }
})

// "Contact Hyperbole" from inside the dashboard — a logged-in client sending a
// message to the agency. Routes through the same guardrailed email path as all
// platform email (test-mode + daily cap), to SUPERADMIN_NOTIFY_EMAIL. The
// sender's identity comes from their Clerk session, never the request body, so
// it can't be spoofed.
clientsRouter.post('/:id/contact-agency', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : ''
  if (!message) return res.status(400).json({ error: 'A message is required' })
  if (message.length > 4000) return res.status(400).json({ error: 'Message is too long' })

  // Dedicated agency contact inbox, falling back to the general superadmin
  // notify address if unset.
  const to = process.env.AGENCY_CONTACT_EMAIL ?? process.env.SUPERADMIN_NOTIFY_EMAIL
  if (!to) return res.status(500).json({ error: 'Contact is not configured' })

  const client = await getClientById(req.params.id)
  const senderEmail = await getUserEmail(identity.userId)
  const subject = `Contact from ${client?.name ?? 'a client'}${senderEmail ? ` (${senderEmail})` : ''}`
  const body = `${client?.name ?? 'A client'} sent a message from their dashboard:\n\n${message}\n\n— From: ${senderEmail ?? identity.userId}\nClient: ${client?.name ?? req.params.id} (${req.params.id})`

  try {
    const result = await sendGuardedEmail({ clientId: req.params.id, event: 'contact.agency', to, subject, body })
    if (!result.sent) return res.status(502).json({ error: 'Message could not be sent right now — please email hello@hyperboledigital.com directly.' })
    res.json({ ok: true })
  } catch (err) {
    console.error('[clients] contact-agency error', err)
    res.status(500).json({ error: 'Failed to send message' })
  }
})

// Dashboard summary stats for a client
clientsRouter.get('/:id/stats', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  res.json(await getStats(req.params.id))
})

// Site Health (Care tier baseline — uptime + SSL, every client regardless of
// add-on services, no isEntitled gate). Read-only latest check.
clientsRouter.get('/:id/site-health', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  res.json(await getLatestSiteHealth(req.params.id))
})

// Triggers a fresh on-demand check. No paid API involved (just our own
// fetch + TLS handshake), so any client on the account — not just
// superadmin — can trigger it. Debounced to at most once/minute per client
// so repeated page loads don't hammer the client's own site.
clientsRouter.post('/:id/site-health/check', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  const client = await getClientById(req.params.id)
  if (!client) return res.status(404).json({ error: 'Client not found' })
  if (!client.domain) return res.status(400).json({ error: 'No domain configured for this client' })

  const latest = await getLatestSiteHealth(req.params.id)
  if (latest && Date.now() - new Date(latest.checkedAt).getTime() < 60_000) {
    return res.json(latest)
  }
  try {
    res.json(await recordSiteHealthCheck(req.params.id, client.domain))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Site health check failed' })
  }
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
// Upload a chat-widget logo. Writes the bytes to the widget-logos bucket and
// records the path on widget_config, which makes it win over any manually
// entered logo URL. The old file is cleaned up so replacing a logo repeatedly
// doesn't accumulate orphans.
clientsRouter.post('/:id/widget-logo', upload.single('file'), async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })

  const file = req.file
  if (!file) return res.status(400).json({ error: 'file required (multipart field "file")' })
  if (!ALLOWED_LOGO_TYPES.includes(file.mimetype)) {
    return res.status(400).json({ error: `Unsupported image type: ${file.mimetype}. Use PNG, JPEG, WebP, SVG, or GIF.` })
  }
  if (file.buffer.length > MAX_LOGO_BYTES) {
    return res.status(400).json({ error: `Logo is too large (${Math.round(file.buffer.length / 1024)}KB). Max ${MAX_LOGO_BYTES / 1024}KB — every visitor loads this.` })
  }

  try {
    const client = await getClientById(req.params.id)
    if (!client) return res.status(404).json({ error: 'Client not found' })

    const previous = client.widgetConfig?.logoPath
    const { storagePath, contentType } = await uploadLogo(req.params.id, file.mimetype, file.buffer)

    const updated = await upsertClient({
      id: req.params.id,
      widgetConfig: { ...(client.widgetConfig ?? {}), logoPath: storagePath, logoContentType: contentType }
    })
    if (previous) await deleteLogo(previous)

    res.json(updated)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to upload logo' })
  }
})

// Clears the uploaded logo (falls back to the manual URL, then the emoji /
// first-letter avatar).
clientsRouter.delete('/:id/widget-logo', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })

  try {
    const client = await getClientById(req.params.id)
    if (!client) return res.status(404).json({ error: 'Client not found' })

    const previous = client.widgetConfig?.logoPath
    const next = { ...(client.widgetConfig ?? {}) }
    delete next.logoPath
    delete next.logoContentType

    const updated = await upsertClient({ id: req.params.id, widgetConfig: next })
    if (previous) await deleteLogo(previous)

    res.json(updated)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to remove logo' })
  }
})

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

// ── Local Presence: citations + GBP activity (the `local` tier-only service) ──
// Hand-maintained trackers (see lib/local-presence.ts). Reads are open to any
// entitled client; writes are superadmin-only, since this is the agency
// recording work it performed, not something the client edits.

async function requireLocalAccess(req: Request, res: import('express').Response): Promise<string | null> {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) {
    res.status(403).json({ error: 'Forbidden' })
    return null
  }
  if (!(await isEntitled(req.params.id, 'local'))) {
    res.status(403).json({ error: 'Not entitled', service: 'local' })
    return null
  }
  return req.params.id
}

async function requireLocalWrite(req: Request, res: import('express').Response): Promise<string | null> {
  const identity = identityOf(req)
  if (!identity?.isSuperadmin) {
    res.status(403).json({ error: 'Forbidden' })
    return null
  }
  return requireLocalAccess(req, res)
}

clientsRouter.get('/:id/local/citations', async (req, res) => {
  const id = await requireLocalAccess(req, res)
  if (!id) return
  const citations = await listCitations(id)
  res.json({ citations, summary: summarizeCitations(citations) })
})

clientsRouter.post('/:id/local/citations', async (req, res) => {
  const id = await requireLocalWrite(req, res)
  if (!id) return
  if (!req.body?.directory) return res.status(400).json({ error: 'directory is required' })
  try {
    res.json(await upsertCitation(id, req.body))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to save citation' })
  }
})

// Bulk-adds the standard local directory checklist, skipping any already
// tracked — the "40+ directories" line made concrete.
clientsRouter.post('/:id/local/citations/seed', async (req, res) => {
  const id = await requireLocalWrite(req, res)
  if (!id) return
  try {
    res.json({ added: await seedStandardDirectories(id) })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to seed directories' })
  }
})

clientsRouter.delete('/:id/local/citations/:citationId', async (req, res) => {
  const id = await requireLocalWrite(req, res)
  if (!id) return
  try {
    await deleteCitation(id, req.params.citationId)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete citation' })
  }
})

clientsRouter.get('/:id/local/gbp', async (req, res) => {
  const id = await requireLocalAccess(req, res)
  if (!id) return
  const days = Number(req.query.days) || 90
  const activity = await listGbpActivity(id, days)
  res.json({ activity, postsThisMonth: postsThisMonth(activity) })
})

clientsRouter.post('/:id/local/gbp', async (req, res) => {
  const id = await requireLocalWrite(req, res)
  if (!id) return
  if (!req.body?.title || !req.body?.kind) return res.status(400).json({ error: 'kind and title are required' })
  try {
    res.json(await addGbpActivity(id, req.body))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to log activity' })
  }
})

clientsRouter.delete('/:id/local/gbp/:activityId', async (req, res) => {
  const id = await requireLocalWrite(req, res)
  if (!id) return
  try {
    await deleteGbpActivity(id, req.params.activityId)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete activity' })
  }
})

// Auto-pulled Google reviews (Places API) — no manual logging needed, unlike
// posts/photos/Q&A which the GBP-proper API gates behind approval.
clientsRouter.get('/:id/local/reviews', async (req, res) => {
  const id = await requireLocalAccess(req, res)
  if (!id) return
  if (!placesConfigured()) return res.status(500).json({ error: 'Reviews not configured' })

  const client = await getClientById(id)
  const placeId = client?.portalConfig?.placeId
  if (!placeId) return res.status(400).json({ error: 'No Place ID configured for this client' })

  try {
    res.json(await fetchPlaceSummary(placeId))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to fetch reviews' })
  }
})

// Auto-checked Google Maps 3-pack position for each configured keyword.
clientsRouter.get('/:id/local/map-rank', async (req, res) => {
  const id = await requireLocalAccess(req, res)
  if (!id) return
  if (!crawlConfigured()) return res.status(500).json({ error: 'Rank tracking not configured' })

  const client = await getClientById(id)
  const keywords = client?.portalConfig?.localKeywords ?? []
  const locations = resolveLocalLocations(client?.portalConfig)
  if (!keywords.length) return res.status(400).json({ error: 'No target keywords configured' })
  if (!locations.length) return res.status(400).json({ error: 'No location configured' })

  try {
    // Every keyword is checked from every location — rank is location-specific,
    // and a client may be tracked across several cities.
    const pairs = locations.flatMap(loc => keywords.map(kw => ({ kw, loc })))
    const results = await Promise.all(
      pairs.map(({ kw, loc }) => checkMapPackRank(kw, loc, client?.portalConfig?.placeId ?? null, client?.name ?? ''))
    )
    res.json({ results })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to check rank' })
  }
})

// Resolve the map-search locations for a client, preferring the plural field
// and falling back to the legacy single `localLocation` so older records keep
// working. Returns [] when none set.
function resolveLocalLocations(cfg?: { localLocations?: string[]; localLocation?: string }): string[] {
  if (cfg?.localLocations?.length) return cfg.localLocations
  if (cfg?.localLocation) return [cfg.localLocation]
  return []
}

// Local Presence config — Place ID, map-pack keywords, and search locations.
// Lives here (not under seo/config) so it's edited from the Local Presence page
// it drives, and is gated on the `local` service rather than `seo`.
clientsRouter.get('/:id/local/config', async (req, res) => {
  const id = await requireLocalAccess(req, res)
  if (!id) return
  const client = await getClientById(id)
  const cfg = client?.portalConfig ?? {}
  res.json({
    placeId: cfg.placeId ?? '',
    localKeywords: cfg.localKeywords ?? [],
    localLocations: resolveLocalLocations(cfg)
  })
})

clientsRouter.put('/:id/local/config', async (req, res) => {
  const id = await requireLocalWrite(req, res)
  if (!id) return
  const client = await getClientById(id)
  if (!client) return res.status(404).json({ error: 'Not found' })
  const { placeId, localKeywords, localLocations } = req.body ?? {}
  const portalConfig = {
    ...client.portalConfig,
    ...(typeof placeId === 'string' ? { placeId } : {}),
    ...(Array.isArray(localKeywords) ? { localKeywords } : {}),
    // Once the plural field is written, drop the legacy singular so the two
    // can't drift out of sync.
    ...(Array.isArray(localLocations) ? { localLocations, localLocation: undefined } : {})
  }
  const updated = await upsertClient({ id, portalConfig })
  const cfg = updated.portalConfig ?? {}
  res.json({
    placeId: cfg.placeId ?? '',
    localKeywords: cfg.localKeywords ?? [],
    localLocations: resolveLocalLocations(cfg)
  })
})

// Resolve a business name to Place ID candidates, so the operator picks their
// business instead of hunting for a raw ID. Costs Places API calls, so it's
// gated to superadmin (requireLocalWrite).
clientsRouter.get('/:id/local/place-search', async (req, res) => {
  const id = await requireLocalWrite(req, res)
  if (!id) return
  if (!placesConfigured()) return res.status(500).json({ error: 'Places lookup not configured' })
  const q = typeof req.query.q === 'string' ? req.query.q : ''
  try {
    res.json({ candidates: await searchBusinesses(q) })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to search' })
  }
})

// ── Paid Ads (the `ads` add-on service) ─────────────────────────────────────
// Read-only Google Ads (PPC) reporting. Delivery of the campaigns is manual;
// the client pays Google directly. The googleAdsCustomerId is superadmin-set.

async function requireAdsAccess(req: Request, res: import('express').Response): Promise<string | null> {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) {
    res.status(403).json({ error: 'Forbidden' })
    return null
  }
  if (!(await isEntitled(req.params.id, 'ads'))) {
    res.status(403).json({ error: 'Not entitled', service: 'ads' })
    return null
  }
  return req.params.id
}

// Live performance + trend. `connected` is false when the deployment has no
// Google Ads creds OR the client has no customer id linked yet — the UI shows a
// "connect your account" state, same contract as GSC rankings.
clientsRouter.get('/:id/ads', async (req, res) => {
  const id = await requireAdsAccess(req, res)
  if (!id) return
  const customerId = await getConnectedCustomerId(id)
  if (!googleAdsConfigured() || !customerId) return res.json({ connected: false, customerId: customerId ?? null, trend: [], latest: null })
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 30))
  try {
    const [trend, live] = await Promise.all([getAdsTrend(id, days), fetchAdsPerformance(id, days)])
    res.json({ connected: !!live, customerId, trend, latest: live })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to load ads performance' })
  }
})

// Manually persist today's ads snapshot for the trend chart (no scheduler —
// same click-driven stand-in as GSC).
clientsRouter.post('/:id/ads/snapshot', async (req, res) => {
  const id = await requireAdsAccess(req, res)
  if (!id) return
  if (!googleAdsConfigured()) return res.status(400).json({ error: 'Google Ads is not configured on this deployment' })
  try {
    await snapshotAds(id)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to snapshot ads' })
  }
})

// Link the client's Google Ads customer id — superadmin only (set during
// onboarding when granting manager access).
clientsRouter.put('/:id/ads/config', async (req, res) => {
  const identity = identityOf(req)
  if (!identity.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  const client = await getClientById(req.params.id)
  if (!client) return res.status(404).json({ error: 'Not found' })
  const { googleAdsCustomerId } = req.body ?? {}
  const portalConfig = {
    ...client.portalConfig,
    ...(typeof googleAdsCustomerId === 'string' ? { googleAdsCustomerId: googleAdsCustomerId.trim() } : {})
  }
  const updated = await upsertClient({ id: req.params.id, portalConfig })
  res.json(updated.portalConfig)
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
  // Local-presence fields (placeId/localKeywords/localLocation) are edited on
  // the Local Presence page via PUT /:id/local/config, not here.
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

// ── Target-keyword rank tracking ─────────────────────────────────────────
// The keywords a client is trying to rank for + their organic position trend.
// Reads open to entitled seo clients; the list is edited by superadmin, and
// the rank check spends DataForSEO credits so it's superadmin-only.
clientsRouter.get('/:id/seo/keywords', async (req, res) => {
  const id = await requireSeoAccess(req, res)
  if (!id) return
  res.json({ keywords: await listTargetKeywords(id) })
})

clientsRouter.post('/:id/seo/keywords', async (req, res) => {
  const identity = identityOf(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  const id = await requireSeoAccess(req, res)
  if (!id) return
  const keyword = typeof req.body?.keyword === 'string' ? req.body.keyword : ''
  try {
    await addTargetKeyword(id, keyword)
    res.json({ keywords: await listTargetKeywords(id) })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to add keyword' })
  }
})

clientsRouter.delete('/:id/seo/keywords/:keywordId', async (req, res) => {
  const identity = identityOf(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  const id = await requireSeoAccess(req, res)
  if (!id) return
  try {
    await removeTargetKeyword(id, req.params.keywordId)
    res.json({ keywords: await listTargetKeywords(id) })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to remove keyword' })
  }
})

clientsRouter.post('/:id/seo/keywords/check', async (req, res) => {
  const identity = identityOf(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  const id = await requireSeoAccess(req, res)
  if (!id) return
  if (!crawlConfigured()) return res.status(400).json({ error: 'Rank tracking is not configured on this deployment' })
  try {
    res.json({ keywords: await checkKeywordRanks(id) })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to check rankings' })
  }
})

// Keyword research — expand a seed into long-tail ideas with volume +
// difficulty, so superadmin can pick which keywords are worth tracking instead
// of guessing. Spends DataForSEO credits, so superadmin-only.
clientsRouter.get('/:id/seo/keyword-ideas', async (req, res) => {
  const identity = identityOf(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  const id = await requireSeoAccess(req, res)
  if (!id) return
  if (!crawlConfigured()) return res.status(400).json({ error: 'Keyword research is not configured on this deployment' })
  const seed = typeof req.query.seed === 'string' ? req.query.seed.trim() : ''
  if (!seed) return res.status(400).json({ error: 'A seed keyword is required' })
  try {
    res.json({ ideas: await researchKeywords(seed) })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to research keywords' })
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

// Score trend + per-check history across every finished audit. Read-only, so
// it follows the same entitlement as the latest crawl above — a client should
// be able to see their own improvement, not just today's number.
//
// MUST stay above the '/:crawlId' route below: Express matches in registration
// order, so declaring it after would make 'history' parse as a crawl id and
// fall into refreshCrawl().
clientsRouter.get('/:id/seo/crawl/history', async (req, res) => {
  const id = await requireSeoAccess(req, res)
  if (!id) return
  res.json(await getCrawlTrend(id))
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

// Release a stuck 'running' crawl so a fresh one can be started. Superadmin-only
// (mutates crawl state), same as starting one.
clientsRouter.post('/:id/seo/crawl/:crawlId/cancel', async (req, res) => {
  const identity = identityOf(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  const id = await requireSeoAccess(req, res)
  if (!id) return
  try {
    res.json(await cancelCrawl(id, req.params.crawlId))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to cancel crawl' })
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

// Permanent delete — superadmin only. Clients cancel their own requests
// (POST .../cancel below), which keeps the record; this removes it entirely,
// including attachment files. Not offered to clients on purpose: a paper
// trail of what was asked for shouldn't be erasable by either side casually.
clientsRouter.delete('/:id/requests/:reqId', async (req, res) => {
  const identity = identityOf(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  try {
    await deleteRequest(req.params.id, req.params.reqId)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete request' })
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
  const mentions = Array.isArray(req.body?.mentions) ? req.body.mentions.filter((m: unknown) => typeof m === 'string') : []
  try {
    res.json(await addComment(req.params.reqId, identity.userId, !!identity.isSuperadmin, body, mentions))
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to add comment' })
  }
})

// Users who can be @mentioned in this client's request comments: the Hyperbole
// team + the client's own Clerk org members. Backs the composer's "@" picker.
clientsRouter.get('/:id/mentionable-users', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  res.json(await getMentionableUsers(req.params.id))
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

// The content engine is internal agency tooling — we draft, review, and publish
// posts on the client's behalf, so it's superadmin-only even for a client who
// pays for the service. The dashboard hides the section from clients; this is
// the check that actually enforces it, since a hidden nav link is not access
// control.
async function requireContentAccess(req: Request, res: import('express').Response): Promise<string | null> {
  const identity = identityOf(req)
  if (!identity.isSuperadmin) {
    res.status(403).json({ error: 'Forbidden' })
    return null
  }
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

// ── Technical SEO baseline (Care tier) ───────────────────────────────────────
// Deliberately NOT behind assertEntitled('seo'): Care includes no services, so
// gating this on the SEO add-on would hide the one technical read the tier
// actually promises from every client entitled to it.

clientsRouter.get('/:id/baseline', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  res.json(await latestBaseline(req.params.id))
})

clientsRouter.post('/:id/baseline/run', async (req, res) => {
  const identity = identityOf(req)
  if (!(await canAccessClient(identity, req.params.id))) return res.status(403).json({ error: 'Forbidden' })
  if (!pagespeedConfigured()) return res.status(400).json({ error: 'PAGESPEED_API_KEY is not configured on this deployment' })
  try {
    res.json(await runSiteBaseline(req.params.id))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to run the site check' })
  }
})

// Superadmin "run the monthly report now" — same code path the scheduler uses,
// including the once-per-period claim, so testing it cannot cause a client to
// receive two emails for the same month.
clientsRouter.post('/:id/reports/run-monthly', async (req, res) => {
  const identity = identityOf(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  const client = await getClientById(req.params.id)
  if (!client) return res.status(404).json({ error: 'Client not found' })
  const periodKey = typeof req.body?.periodKey === 'string' ? req.body.periodKey : previousPeriodKey()
  try {
    res.json(await deliverMonthlyReport(client.id, client.name, periodKey))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to run the monthly report' })
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

// Superadmin only: clients view their reports, they don't curate them.
clientsRouter.delete('/:id/reports/:reportId', async (req, res) => {
  const identity = identityOf(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  try {
    await deleteReport(req.params.id, req.params.reportId)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete report' })
  }
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

// ── Team (Clerk org members + invitations) ───────────────────────────────────
// The team is the Clerk Organization that owns this client, so seats are read
// from `client.clerkOrgId` rather than the caller's own org — that way a
// superadmin can manage a client's team from the console too.
async function resolveTeamOrg(identity: Identity, clientId: string): Promise<
  { ok: true; orgId: string } | { ok: false; status: number; error: string }
> {
  if (!(await canAccessClient(identity, clientId))) return { ok: false, status: 403, error: 'Forbidden' }
  const client = await getClientById(clientId)
  if (!client) return { ok: false, status: 404, error: 'Not found' }
  if (!client.clerkOrgId) {
    return { ok: false, status: 409, error: 'This client isn\'t linked to an organization yet' }
  }
  return { ok: true, orgId: client.clerkOrgId }
}

function teamFailed(err: unknown, fallback: string) {
  if (err instanceof TeamError) return { status: 400, error: err.message }
  console.error('[team]', err)
  return { status: 500, error: fallback }
}

clientsRouter.get('/:id/team', async (req, res) => {
  const identity = identityOf(req)
  const org = await resolveTeamOrg(identity, req.params.id)
  if (!org.ok) return res.status(org.status).json({ error: org.error })
  try {
    const team = await getTeam(org.orgId)
    res.json({ ...team, canManage: canManageTeam(identity), currentUserId: identity.userId })
  } catch (err) {
    const { status, error } = teamFailed(err, 'Failed to load team')
    res.status(status).json({ error })
  }
})

clientsRouter.post('/:id/team/invitations', async (req, res) => {
  const identity = identityOf(req)
  const org = await resolveTeamOrg(identity, req.params.id)
  if (!org.ok) return res.status(org.status).json({ error: org.error })
  if (!canManageTeam(identity)) return res.status(403).json({ error: 'Only an admin can invite team members' })

  const email = typeof req.body?.email === 'string' ? req.body.email : ''
  const role = isTeamRole(req.body?.role) ? req.body.role : 'org:member'
  try {
    res.json(await inviteMember(org.orgId, identity.userId, email, role))
  } catch (err) {
    const { status, error } = teamFailed(err, 'Failed to send invite')
    res.status(status).json({ error })
  }
})

clientsRouter.delete('/:id/team/invitations/:invitationId', async (req, res) => {
  const identity = identityOf(req)
  const org = await resolveTeamOrg(identity, req.params.id)
  if (!org.ok) return res.status(org.status).json({ error: org.error })
  if (!canManageTeam(identity)) return res.status(403).json({ error: 'Only an admin can revoke invites' })
  try {
    await revokeInvitation(org.orgId, req.params.invitationId, identity.userId)
    res.json({ ok: true })
  } catch (err) {
    const { status, error } = teamFailed(err, 'Failed to revoke invite')
    res.status(status).json({ error })
  }
})

clientsRouter.patch('/:id/team/members/:userId', async (req, res) => {
  const identity = identityOf(req)
  const org = await resolveTeamOrg(identity, req.params.id)
  if (!org.ok) return res.status(org.status).json({ error: org.error })
  if (!canManageTeam(identity)) return res.status(403).json({ error: 'Only an admin can change roles' })
  if (!isTeamRole(req.body?.role)) return res.status(400).json({ error: 'Invalid role' })
  try {
    res.json(await updateMemberRole(org.orgId, req.params.userId, req.body.role))
  } catch (err) {
    const { status, error } = teamFailed(err, 'Failed to update role')
    res.status(status).json({ error })
  }
})

clientsRouter.delete('/:id/team/members/:userId', async (req, res) => {
  const identity = identityOf(req)
  const org = await resolveTeamOrg(identity, req.params.id)
  if (!org.ok) return res.status(org.status).json({ error: org.error })
  if (!canManageTeam(identity)) return res.status(403).json({ error: 'Only an admin can remove team members' })
  try {
    await removeMember(org.orgId, req.params.userId)
    res.json({ ok: true })
  } catch (err) {
    const { status, error } = teamFailed(err, 'Failed to remove member')
    res.status(status).json({ error })
  }
})
