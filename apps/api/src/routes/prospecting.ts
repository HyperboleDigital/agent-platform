import { Router } from 'express'
import multer from 'multer'
import { getIdentity } from '../lib/authz'
import {
  discoverProspects, listProspects, getProspect, saveProspect, updateProspect, deleteProspect,
  generateDrafts, prospectsCsv, type ProspectStatus,
} from '../lib/prospecting'
import { placesConfigured } from '../lib/places'
import { startAdhocCrawl, crawlConfigured } from '../lib/dataforseo'
import {
  generateMockup, listMockups, getMockup, getMockupImage, mockupsConfigured, STYLES, previewGeneration,
} from '../lib/prospect-mockups'
import { createPreview, listPreviews, revokePreview, previewUrl } from '../lib/prospect-previews'
import {
  listReferences, getReference, uploadReference, updateReference, deleteReference, getReferenceImage,
  listLibraries, createLibrary, updateLibrary, deleteLibrary,
} from '../lib/design-references'

export const prospectingRouter = Router()

// Memory storage, same posture as clientsRouter's uploader: these go straight
// to Supabase storage and never touch the container's disk.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } })

const ALLOWED_REFERENCE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

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

// Static segments registered before the '/:id' routes below so they can't be
// shadowed (same reasoning as /export.csv above).
prospectingRouter.get('/mockup-styles', (_req, res) => {
  res.json(STYLES.map(s => ({ key: s.key, label: s.label })))
})

// Authenticated image fetch, so the dashboard can show a concept before any
// public preview link exists. The public equivalent is GET /p/:token/image.
prospectingRouter.get('/mockups/:mockupId/image', async (req, res) => {
  try {
    const mockup = await getMockup(req.params.mockupId)
    if (!mockup) return res.status(404).json({ error: 'Mockup not found' })
    // HTML concepts have no PNG — the dashboard iframes them instead.
    if (!mockup.storagePath) return res.status(404).json({ error: 'This concept is HTML, not an image' })
    res.type('png').send(await getMockupImage(mockup.storagePath))
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'Image not found' })
  }
})

// ── Design libraries ──────────────────────────────────────────────────────────
// Operator-named collections of the inspo images below — e.g. "Roofing",
// "Med Spa" — chosen explicitly per prospect when generating a concept
// (POST /:id/mockups). Registered before the '/:id' routes for the same
// shadowing reason as design-references.

prospectingRouter.get('/design-libraries', async (_req, res) => {
  try {
    res.json(await listLibraries())
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to list design libraries' })
  }
})

prospectingRouter.post('/design-libraries', async (req, res) => {
  const { name, description } = req.body ?? {}
  if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name is required' })
  try {
    res.json(await createLibrary({ name, description: typeof description === 'string' ? description : null }))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create design library' })
  }
})

prospectingRouter.patch('/design-libraries/:libraryId', async (req, res) => {
  const { name, description } = req.body ?? {}
  try {
    res.json(await updateLibrary(req.params.libraryId, {
      ...(typeof name === 'string' ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
    }))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update design library' })
  }
})

// References inside a deleted library are NOT deleted — they become
// unassigned (see lib/design-references.ts deleteLibrary).
prospectingRouter.delete('/design-libraries/:libraryId', async (req, res) => {
  try {
    await deleteLibrary(req.params.libraryId)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete design library' })
  }
})

// ── Design reference library ─────────────────────────────────────────────────
// The operator's inspo images. Concept generation imitates these and nothing
// else, so this is where design direction actually lives. Registered before
// the '/:id' routes so 'design-references' isn't read as a prospect id.

prospectingRouter.get('/design-references', async (req, res) => {
  try {
    const includeInactive = req.query.includeInactive === 'true'
    const libraryId = typeof req.query.libraryId === 'string' ? req.query.libraryId : undefined
    res.json(await listReferences({ includeInactive, libraryId: libraryId === 'unassigned' ? null : libraryId }))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to list design references' })
  }
})

prospectingRouter.post('/design-references', upload.single('file'), async (req, res) => {
  const file = req.file
  if (!file) return res.status(400).json({ error: 'file required (multipart field "file")' })
  // The whole point of these is to be shown to a vision model, so a format it
  // can't read is a silent no-op rather than an upload worth keeping.
  if (!ALLOWED_REFERENCE_TYPES.includes(file.mimetype)) {
    return res.status(400).json({ error: `Unsupported image type: ${file.mimetype}. Use PNG, JPEG, WebP, or GIF.` })
  }
  const { label, libraryId, notes } = req.body ?? {}
  try {
    res.json(await uploadReference({
      label: typeof label === 'string' && label.trim() ? label.trim() : file.originalname,
      libraryId: typeof libraryId === 'string' && libraryId ? libraryId : null,
      notes: typeof notes === 'string' ? notes : null,
      contentType: file.mimetype,
      buffer: file.buffer,
    }))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to upload design reference' })
  }
})

prospectingRouter.get('/design-references/:refId/image', async (req, res) => {
  try {
    const reference = await getReference(req.params.refId)
    if (!reference) return res.status(404).json({ error: 'Design reference not found' })
    res.type(reference.contentType).send(await getReferenceImage(reference.storagePath))
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'Image not found' })
  }
})

prospectingRouter.patch('/design-references/:refId', async (req, res) => {
  const { label, libraryId, notes, active } = req.body ?? {}
  try {
    res.json(await updateReference(req.params.refId, {
      ...(typeof label === 'string' ? { label } : {}),
      ...(libraryId !== undefined ? { libraryId } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(typeof active === 'boolean' ? { active } : {}),
    }))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to update design reference' })
  }
})

prospectingRouter.delete('/design-references/:refId', async (req, res) => {
  try {
    await deleteReference(req.params.refId)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete design reference' })
  }
})

prospectingRouter.post('/previews/:previewId/revoke', async (req, res) => {
  try {
    res.json(await revokePreview(req.params.previewId))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to revoke preview' })
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

prospectingRouter.delete('/:id', async (req, res) => {
  try {
    await deleteProspect(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete prospect' })
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

// ── Mockup concepts + shareable preview ──────────────────────────────────────
// Still no send path: these produce an image and a link the operator pastes
// into the email they send themselves.

prospectingRouter.get('/:id/mockups', async (req, res) => {
  try {
    res.json(await listMockups(req.params.id))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to list mockups' })
  }
})

// Generates a NEW concept each call — "regenerate" is just calling it again,
// so an already-shared preview keeps showing what was actually sent.
prospectingRouter.post('/:id/mockups', async (req, res) => {
  if (!mockupsConfigured()) return res.status(400).json({ error: 'OPENAI_API_KEY is not configured on this deployment' })
  const { styleKey, directionNotes, libraryId } = req.body ?? {}
  try {
    res.json(await generateMockup(req.params.id, {
      styleKey: typeof styleKey === 'string' ? styleKey : undefined,
      directionNotes: typeof directionNotes === 'string' ? directionNotes : undefined,
      libraryId: typeof libraryId === 'string' && libraryId ? libraryId : null,
    }))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to generate mockup' })
  }
})

// Assembles the same prompt + images generateMockup would send, without
// calling Claude — zero LLM cost. Lets the operator paste the result into a
// free tool (ChatGPT, Gemini) to sanity-check the design library and prompt
// before spending real tokens on a generation that gets saved as a mockup.
// No mockupsConfigured() guard: unlike generation, this never touches
// Anthropic, so it works even before ANTHROPIC_API_KEY is set.
prospectingRouter.post('/:id/mockups/preview', async (req, res) => {
  const { directionNotes, libraryId } = req.body ?? {}
  try {
    res.json(await previewGeneration(req.params.id, {
      directionNotes: typeof directionNotes === 'string' ? directionNotes : undefined,
      libraryId: typeof libraryId === 'string' && libraryId ? libraryId : null,
    }))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to build preview' })
  }
})

prospectingRouter.get('/:id/previews', async (req, res) => {
  try {
    const previews = await listPreviews(req.params.id)
    res.json(previews.map(p => ({ ...p, url: previewUrl(p.previewToken) })))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to list previews' })
  }
})

// A preview pins a specific (mockup, crawl) pair, so regenerating either
// afterwards doesn't change what an already-shared link shows.
prospectingRouter.post('/:id/previews', async (req, res) => {
  const { mockupId, crawlId } = req.body ?? {}
  try {
    const preview = await createPreview(req.params.id, {
      mockupId: typeof mockupId === 'string' ? mockupId : null,
      crawlId: typeof crawlId === 'string' ? crawlId : null,
    })
    res.json({ ...preview, url: previewUrl(preview.previewToken) })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to create preview' })
  }
})
