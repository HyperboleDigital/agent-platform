import { Router } from 'express'
import { getIdentity } from '../lib/authz'
import {
  discoverProspects, listProspects, getProspect, saveProspect, updateProspect,
  generateDrafts, prospectsCsv, type ProspectStatus,
} from '../lib/prospecting'
import { placesConfigured } from '../lib/places'
import { startAdhocCrawl, crawlConfigured } from '../lib/dataforseo'

export const prospectingRouter = Router()

// Cold-outreach prospecting is an admin tool — superadmin only, no per-client
// scoping (mirrors overviewRouter's guard).
prospectingRouter.use((req, res, next) => {
  const identity = getIdentity(req)
  if (!identity?.isSuperadmin) return res.status(403).json({ error: 'Forbidden' })
  next()
})

const VALID_STATUSES: ProspectStatus[] = [
  'new', 'saved', 'drafted', 'sent', 'replied', 'won', 'lost', 'do_not_contact',
]

// Live Places discovery — returns candidates not yet saved.
prospectingRouter.post('/discover', async (req, res) => {
  const { category, area, minRating, minReviewCount, noWebsiteOnly } = req.body ?? {}
  if (typeof category !== 'string' || !category.trim()) return res.status(400).json({ error: 'category is required' })
  if (typeof area !== 'string' || !area.trim()) return res.status(400).json({ error: 'area is required' })
  if (!placesConfigured()) return res.status(400).json({ error: 'Places API is not configured on this deployment' })
  try {
    const candidates = await discoverProspects({
      category, area,
      minRating: typeof minRating === 'number' ? minRating : undefined,
      minReviewCount: typeof minReviewCount === 'number' ? minReviewCount : undefined,
      noWebsiteOnly: !!noWebsiteOnly,
    })
    res.json({ count: candidates.length, candidates })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Discovery failed' })
  }
})

// CSV export — before GET '/' so it isn't shadowed. Opens in Google Sheets.
prospectingRouter.get('/export.csv', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status as ProspectStatus : undefined
  if (status && !VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' })
  try {
    const csv = await prospectsCsv(status)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="prospects.csv"')
    res.send(csv)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Export failed' })
  }
})

prospectingRouter.get('/', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status as ProspectStatus : undefined
  if (status && !VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' })
  try {
    res.json(await listProspects(status))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to list prospects' })
  }
})

// Save a discovered candidate into the prospects table.
prospectingRouter.post('/', async (req, res) => {
  const { candidate, category, area } = req.body ?? {}
  if (!candidate || typeof candidate.placeId !== 'string') return res.status(400).json({ error: 'candidate is required' })
  if (typeof category !== 'string' || typeof area !== 'string') return res.status(400).json({ error: 'category and area are required' })
  try {
    res.json(await saveProspect(candidate, { category, area }))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to save prospect' })
  }
})

prospectingRouter.patch('/:id', async (req, res) => {
  const { status, email, notes } = req.body ?? {}
  if (status !== undefined && !VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' })
  try {
    res.json(await updateProspect(req.params.id, {
      ...(status !== undefined ? { status } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(notes !== undefined ? { notes } : {}),
    }))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update prospect' })
  }
})

// Generate both outreach draft variants for a prospect.
prospectingRouter.post('/:id/draft', async (req, res) => {
  try {
    res.json(await generateDrafts(req.params.id))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to generate drafts' })
  }
})

// Run an on-demand SEO audit of a prospect's site (reuses the Audit Tool
// engine). Returns the crawl to poll, same shape as /overview/audits.
prospectingRouter.post('/:id/audit', async (req, res) => {
  if (!crawlConfigured()) return res.status(400).json({ error: 'Crawl auditing is not configured on this deployment' })
  try {
    const prospect = await getProspect(req.params.id)
    if (!prospect) return res.status(404).json({ error: 'Prospect not found' })
    if (!prospect.website) return res.status(400).json({ error: 'This prospect has no website to audit' })
    res.json(await startAdhocCrawl(prospect.website))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to start audit' })
  }
})
