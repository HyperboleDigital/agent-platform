import { Router } from 'express'
import multer from 'multer'
import { getIdentity } from '../lib/authz'
import {
  discoverProspects, listProspects, getProspect, saveProspect, saveProspects, updateProspect,
  deleteProspect, generateDrafts, generateValueDrafts, prospectsCsv, renameProspectGroup,
  type ProspectStatus, type ProspectFilter,
} from '../lib/prospecting'
import { placesConfigured } from '../lib/places'
import { startAdhocCrawl, crawlConfigured } from '../lib/dataforseo'
import {
  generateMockup, listMockups, getMockup, getMockupImage, mockupsConfigured, STYLES, previewGeneration,
  scrapeBrand, analyzeDesign, generateImageMockup, previewImageMockup, contentTypeForStoredImage,
  runConceptWizard, WIZARD_STEPS, deleteMockup,
  type ExtractedBrand,
} from '../lib/prospect-mockups'
import { createRun, getRun, latestRun, RunTracker } from '../lib/prospect-generation-runs'
import { runEmailWizard, EMAIL_STEPS } from '../lib/prospect-email'
import { imageGenConfigured } from '../lib/llm/image-gen'
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
  const { category, area, minRating, minReviewCount, noWebsiteOnly, forceRefresh } = req.body ?? {}
  if (typeof category !== 'string' || !category.trim()) return res.status(400).json({ error: 'category is required' })
  if (typeof area !== 'string' || !area.trim()) return res.status(400).json({ error: 'area is required' })
  if (!placesConfigured()) return res.status(400).json({ error: 'Places API is not configured on this deployment' })
  try {
    const result = await discoverProspects({
      category, area,
      minRating: typeof minRating === 'number' ? minRating : undefined,
      minReviewCount: typeof minReviewCount === 'number' ? minReviewCount : undefined,
      noWebsiteOnly: !!noWebsiteOnly,
      forceRefresh: !!forceRefresh,
    })
    res.json({ count: result.candidates.length, ...result })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Discovery failed' })
  }
})

// Shared status+group parsing for the list and export routes, so a bad status
// is rejected identically on both.
function parseFilter(req: { query: Record<string, unknown> }): ProspectFilter | { error: string } {
  const status = typeof req.query.status === 'string' && req.query.status ? req.query.status as ProspectStatus : undefined
  if (status && !VALID_STATUSES.includes(status)) return { error: 'Invalid status' }
  const group = typeof req.query.group === 'string' && req.query.group ? req.query.group : undefined
  return { ...(status ? { status } : {}), ...(group ? { group } : {}) }
}

// CSV export — before GET '/' so it isn't shadowed. Opens in Google Sheets.
// Scoped by group so the operator exports just "Roofers" rather than every
// business they've ever saved.
prospectingRouter.get('/export.csv', async (req, res) => {
  const filter = parseFilter(req)
  if ('error' in filter) return res.status(400).json(filter)
  try {
    const csv = await prospectsCsv(filter)
    // Filename carries the group so successive exports don't overwrite each
    // other in the operator's Downloads folder.
    const slug = filter.group ? filter.group.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : ''
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="prospects${slug ? `-${slug}` : ''}.csv"`)
    res.send(csv)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Export failed' })
  }
})

// ── Groups ───────────────────────────────────────────────────────────────────
// The operator's organizing labels over saved prospects. There's no list
// endpoint: the dashboard already loads every prospect for the saved list and
// derives the group set from it, so a second query would only add a cache to
// keep in sync. Registered before the '/:id' routes so 'groups' isn't read as
// a prospect id.

// Rename in bulk — moves every prospect currently in `from` into `to`. If `to`
// is an existing group this merges the two, which is the intended way to
// collapse "Roofer" and "Roofing" into one.
prospectingRouter.post('/groups/rename', async (req, res) => {
  const { from, to } = req.body ?? {}
  if (typeof from !== 'string' || !from.trim()) return res.status(400).json({ error: 'from is required' })
  if (typeof to !== 'string' || !to.trim()) return res.status(400).json({ error: 'to is required' })
  try {
    res.json({ moved: await renameProspectGroup(from, to.trim()) })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to rename group' })
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
    res.type(contentTypeForStoredImage(mockup.storagePath)).send(await getMockupImage(mockup.storagePath))
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'Image not found' })
  }
})

// The layout-first draft the HTML concept was built from. Authenticated and
// dashboard-only on purpose — it's a rough working image with garbled text,
// and there is deliberately no public /p/:token equivalent, because the
// prospect must only ever see the finished HTML page.
prospectingRouter.get('/mockups/:mockupId/layout-image', async (req, res) => {
  try {
    const mockup = await getMockup(req.params.mockupId)
    if (!mockup) return res.status(404).json({ error: 'Mockup not found' })
    if (!mockup.layoutImagePath) return res.status(404).json({ error: 'This concept was not generated layout-first' })
    res.type(contentTypeForStoredImage(mockup.layoutImagePath)).send(await getMockupImage(mockup.layoutImagePath))
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
  const filter = parseFilter(req)
  if ('error' in filter) return res.status(400).json(filter)
  try {
    res.json(await listProspects(filter))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to list prospects' })
  }
})

// Save a discovered candidate into the prospects table.
prospectingRouter.post('/', async (req, res) => {
  const { candidate, category, area, groupName } = req.body ?? {}
  if (!candidate || typeof candidate.placeId !== 'string') return res.status(400).json({ error: 'candidate is required' })
  if (typeof category !== 'string' || typeof area !== 'string') return res.status(400).json({ error: 'category and area are required' })
  try {
    res.json(await saveProspect(candidate, {
      category, area,
      ...(typeof groupName === 'string' && groupName.trim() ? { groupName } : {}),
    }))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to save prospect' })
  }
})

// Bulk save — one round trip for a whole checkbox selection. Capped so a
// runaway client can't push an unbounded upsert; discovery returns ~60 max, so
// this is well above any legitimate selection.
const MAX_BULK_SAVE = 200

prospectingRouter.post('/bulk', async (req, res) => {
  const { candidates, category, area, groupName } = req.body ?? {}
  if (!Array.isArray(candidates) || !candidates.length) return res.status(400).json({ error: 'candidates must be a non-empty array' })
  if (candidates.length > MAX_BULK_SAVE) return res.status(400).json({ error: `Too many candidates (max ${MAX_BULK_SAVE})` })
  if (candidates.some((c: unknown) => !c || typeof (c as { placeId?: unknown }).placeId !== 'string')) {
    return res.status(400).json({ error: 'every candidate needs a placeId' })
  }
  if (typeof category !== 'string' || typeof area !== 'string') return res.status(400).json({ error: 'category and area are required' })
  try {
    const saved = await saveProspects(candidates, {
      category, area,
      ...(typeof groupName === 'string' && groupName.trim() ? { groupName } : {}),
    })
    res.json({ saved: saved.length, prospects: saved })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to save prospects' })
  }
})

prospectingRouter.patch('/:id', async (req, res) => {
  const { status, email, notes, groupName } = req.body ?? {}
  if (status !== undefined && !VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' })
  if (groupName !== undefined && groupName !== null && typeof groupName !== 'string') {
    return res.status(400).json({ error: 'groupName must be a string or null' })
  }
  try {
    res.json(await updateProspect(req.params.id, {
      ...(status !== undefined ? { status } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(notes !== undefined ? { notes } : {}),
      // Empty string means "remove from its group" rather than a group literally named "".
      ...(groupName !== undefined ? { group_name: groupName?.trim() || null } : {}),
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

// Fuller value-prop email (mockup + real service value props + book-a-call) —
// a distinct draft type from the short first-touch pair above, meant for once
// a mockup exists to reference.
prospectingRouter.post('/:id/value-draft', async (req, res) => {
  try {
    res.json(await generateValueDrafts(req.params.id))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to generate value draft' })
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

// Scrape-only, no persistence, no Anthropic call — backs the dashboard's
// brand-review step so the operator sees (and can correct) what got
// extracted before a generation is spent on it.
prospectingRouter.post('/:id/brand', async (req, res) => {
  try {
    res.json(await scrapeBrand(req.params.id))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to scrape brand' })
  }
})

// Shared by both mockup routes below — validates the operator's edited brand
// fields sent alongside a generation/preview request. Every field optional
// since the panel only sends what the operator actually touched.
function parseBrandOverride(body: unknown): Partial<ExtractedBrand> | { error: string } {
  const raw = (body as { brandOverride?: unknown } | null)?.brandOverride
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object') return { error: 'brandOverride must be an object' }
  const b = raw as Record<string, unknown>
  const override: Partial<ExtractedBrand> = {}
  for (const key of ['businessName', 'headline', 'phone', 'logoUrl', 'license'] as const) {
    if (b[key] === undefined) continue
    if (b[key] !== null && typeof b[key] !== 'string') return { error: `brandOverride.${key} must be a string or null` }
    override[key] = b[key] as string | null
  }
  for (const key of ['services', 'colors', 'photoUrls', 'certifications', 'partnerLogoUrls'] as const) {
    if (b[key] === undefined) continue
    if (!Array.isArray(b[key]) || b[key].some((v: unknown) => typeof v !== 'string')) {
      return { error: `brandOverride.${key} must be an array of strings` }
    }
    override[key] = b[key] as string[]
  }
  return override
}

// Costs one cheap-tier Anthropic call (unlike /brand above, which is free) —
// a dedicated pass that looks at the design references + current site and
// returns a corrected services list plus concrete style direction, rather
// than trusting the blind regex scrape. See analyzeDesign() for why this is
// a separate pass instead of folding into the main HTML generation.
prospectingRouter.post('/:id/analyze', async (req, res) => {
  if (!mockupsConfigured()) return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not configured on this deployment' })
  const { libraryId, primaryReferenceId } = req.body ?? {}
  const brandOverride = parseBrandOverride(req.body)
  if ('error' in brandOverride) return res.status(400).json(brandOverride)
  try {
    res.json(await analyzeDesign(req.params.id, {
      libraryId: typeof libraryId === 'string' && libraryId ? libraryId : null,
      primaryReferenceId: typeof primaryReferenceId === 'string' && primaryReferenceId ? primaryReferenceId : null,
      brandOverride,
    }))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to analyze design' })
  }
})

prospectingRouter.get('/:id/mockups', async (req, res) => {
  try {
    res.json(await listMockups(req.params.id))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to list mockups' })
  }
})

// Discard a concept the operator doesn't want. Refuses while a live preview
// link points at it — see deleteMockup() for why that matters.
prospectingRouter.delete('/mockups/:mockupId', async (req, res) => {
  try {
    await deleteMockup(req.params.mockupId)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to delete concept' })
  }
})

// Generates a NEW concept each call — "regenerate" is just calling it again,
// so an already-shared preview keeps showing what was actually sent.
prospectingRouter.post('/:id/mockups', async (req, res) => {
  if (!mockupsConfigured()) return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not configured on this deployment' })
  const { styleKey, directionNotes, styleNotes, libraryId, primaryReferenceId, layoutFirst, aiPhotos } = req.body ?? {}
  const brandOverride = parseBrandOverride(req.body)
  if ('error' in brandOverride) return res.status(400).json(brandOverride)
  try {
    res.json(await generateMockup(req.params.id, {
      styleKey: typeof styleKey === 'string' ? styleKey : undefined,
      directionNotes: typeof directionNotes === 'string' ? directionNotes : undefined,
      styleNotes: typeof styleNotes === 'string' ? styleNotes : undefined,
      libraryId: typeof libraryId === 'string' && libraryId ? libraryId : null,
      primaryReferenceId: typeof primaryReferenceId === 'string' && primaryReferenceId ? primaryReferenceId : null,
      brandOverride,
      // Adds an image generation ahead of the Claude call — opt in per request
      // rather than defaulting on, since it costs and roughly doubles latency.
      layoutFirst: layoutFirst === true,
      // Adds two more image generations, replacing the business's own scraped
      // photos with clean stock-style ones. Same opt-in reasoning.
      aiPhotos: aiPhotos === true,
    }))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to generate mockup' })
  }
})

// ── One-click wizard ─────────────────────────────────────────────────────────
// Returns a run id immediately and does the work detached. The job takes
// minutes and spends real money, so it must not be tied to the lifetime of
// this request: an operator closing the tab, or a proxy timing out at 60s,
// would otherwise abandon a half-finished run.
prospectingRouter.post('/:id/generate', async (req, res) => {
  if (!mockupsConfigured()) return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not configured on this deployment' })
  if (!imageGenConfigured()) return res.status(400).json({ error: 'Image generation needs GEMINI_API_KEY or OPENAI_API_KEY, neither of which is configured on this deployment' })

  const { libraryId, primaryReferenceId, directionNotes, aiPhotos, layoutFirst } = req.body ?? {}
  const brandOverride = parseBrandOverride(req.body)
  if ('error' in brandOverride) return res.status(400).json(brandOverride)

  const opts = {
    libraryId: typeof libraryId === 'string' && libraryId ? libraryId : null,
    primaryReferenceId: typeof primaryReferenceId === 'string' && primaryReferenceId ? primaryReferenceId : null,
    directionNotes: typeof directionNotes === 'string' && directionNotes.trim() ? directionNotes : undefined,
    brandOverride,
    // Both default ON — the whole point of the one-click path is the good
    // result, not the cheap one. Advanced can turn them off per run.
    aiPhotos: aiPhotos !== false,
    layoutFirst: layoutFirst !== false,
  }

  try {
    const steps = WIZARD_STEPS.map(s => ({ ...s, status: 'pending' as const, pct: 0 }))
    const run = await createRun(req.params.id, steps, {
      aiPhotos: opts.aiPhotos, layoutFirst: opts.layoutFirst,
      libraryId: opts.libraryId, primaryReferenceId: opts.primaryReferenceId,
    })
    const tracker = new RunTracker(run.id, steps)

    // Deliberately not awaited. Errors are recorded on the run row, which is
    // what the dashboard reads — an unhandled rejection here would take the
    // API process down instead.
    void runConceptWizard(req.params.id, tracker, opts)
      .then(mockup => tracker.complete(mockup.id))
      .catch(err => tracker.abort(err instanceof Error ? err.message : 'Generation failed'))

    res.status(202).json(run)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to start generation' })
  }
})

// Polled by the dashboard while a run is in flight. Cheap by design: one row.
prospectingRouter.get('/runs/:runId', async (req, res) => {
  try {
    const run = await getRun(req.params.runId)
    if (!run) return res.status(404).json({ error: 'Run not found' })
    res.json(run)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to load run' })
  }
})

// The run to show on load, so a page refresh mid-generation reattaches to it
// rather than looking idle while the job is still spending money. ?kind=email
// selects the outreach run; concept runs are the default.
prospectingRouter.get('/:id/latest-run', async (req, res) => {
  try {
    const kind = req.query.kind === 'email' ? 'email' : 'concept'
    res.json(await latestRun(req.params.id, kind))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to load run' })
  }
})

// One-click outreach email: link the chosen concept, audit their site, write
// the email using both. Same async run/poll contract as /:id/generate above —
// the audit alone can take minutes, far too long to hold a request open.
prospectingRouter.post('/:id/email', async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not configured on this deployment' })

  const { mockupId, audit } = req.body ?? {}
  const opts = {
    mockupId: typeof mockupId === 'string' && mockupId ? mockupId : null,
    audit: audit !== false,
  }

  try {
    const steps = EMAIL_STEPS.map(s => ({ ...s, status: 'pending' as const, pct: 0 }))
    const run = await createRun(req.params.id, steps, opts, 'email')
    const tracker = new RunTracker(run.id, steps)

    // Not awaited, same reasoning as the concept run: failures are recorded on
    // the row the dashboard polls, never thrown at the HTTP layer.
    void runEmailWizard(req.params.id, tracker, opts)
      .then(() => tracker.complete(null))
      .catch(err => tracker.abort(err instanceof Error ? err.message : 'Email generation failed'))

    res.status(202).json(run)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to start email generation' })
  }
})

// Assembles the same prompt + images generateMockup would send, without
// calling Claude — zero LLM cost. Lets the operator paste the result into a
// free tool (ChatGPT, Gemini) to sanity-check the design library and prompt
// before spending real tokens on a generation that gets saved as a mockup.
// No mockupsConfigured() guard: unlike generation, this never touches
// Anthropic, so it works even before ANTHROPIC_API_KEY is set.
prospectingRouter.post('/:id/mockups/preview', async (req, res) => {
  const { directionNotes, styleNotes, libraryId, primaryReferenceId } = req.body ?? {}
  const brandOverride = parseBrandOverride(req.body)
  if ('error' in brandOverride) return res.status(400).json(brandOverride)
  try {
    res.json(await previewGeneration(req.params.id, {
      directionNotes: typeof directionNotes === 'string' ? directionNotes : undefined,
      styleNotes: typeof styleNotes === 'string' ? styleNotes : undefined,
      libraryId: typeof libraryId === 'string' && libraryId ? libraryId : null,
      primaryReferenceId: typeof primaryReferenceId === 'string' && primaryReferenceId ? primaryReferenceId : null,
      brandOverride,
    }))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to build preview' })
  }
})

// Real generated PNG concept — same body shape as /:id/mockups, gated on an
// image provider being configured (Gemini or, failing that, OpenAI) rather
// than on Anthropic's key.
prospectingRouter.post('/:id/mockups/image', async (req, res) => {
  if (!imageGenConfigured()) return res.status(400).json({ error: 'Image generation needs GEMINI_API_KEY or OPENAI_API_KEY, neither of which is configured on this deployment' })
  const { directionNotes, styleNotes, libraryId, primaryReferenceId } = req.body ?? {}
  const brandOverride = parseBrandOverride(req.body)
  if ('error' in brandOverride) return res.status(400).json(brandOverride)
  try {
    res.json(await generateImageMockup(req.params.id, {
      directionNotes: typeof directionNotes === 'string' ? directionNotes : undefined,
      styleNotes: typeof styleNotes === 'string' ? styleNotes : undefined,
      libraryId: typeof libraryId === 'string' && libraryId ? libraryId : null,
      primaryReferenceId: typeof primaryReferenceId === 'string' && primaryReferenceId ? primaryReferenceId : null,
      brandOverride,
    }))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to generate image concept' })
  }
})

// Free preview for the image path — zero LLM/image-gen cost, same posture as
// /:id/mockups/preview. Worth using here more than ever: unlike the HTML
// path, an image generation costs real money win or lose.
prospectingRouter.post('/:id/mockups/image/preview', async (req, res) => {
  const { directionNotes, styleNotes, libraryId, primaryReferenceId } = req.body ?? {}
  const brandOverride = parseBrandOverride(req.body)
  if ('error' in brandOverride) return res.status(400).json(brandOverride)
  try {
    res.json(await previewImageMockup(req.params.id, {
      directionNotes: typeof directionNotes === 'string' ? directionNotes : undefined,
      styleNotes: typeof styleNotes === 'string' ? styleNotes : undefined,
      libraryId: typeof libraryId === 'string' && libraryId ? libraryId : null,
      primaryReferenceId: typeof primaryReferenceId === 'string' && primaryReferenceId ? primaryReferenceId : null,
      brandOverride,
    }))
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to build image preview' })
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
