import { Router } from 'express'
import { getPreviewByToken, recordView, isPreviewActive } from '../lib/prospect-previews'
import { getProspect } from '../lib/prospecting'
import { getMockup, getMockupImage, getScreenshotImage } from '../lib/prospect-mockups'
import { getAdhocCrawl } from '../lib/dataforseo'
import { renderPreviewPage } from '../lib/prospect-preview-page'

// Public and unauthenticated — a prospect has no login. Mounted BEFORE
// requireAuth in index.ts, alongside /chat and /contact. The preview_token
// (~192 bits) is the only credential, so nothing beyond the concept, the audit
// summary and a booking CTA may ever be rendered here.
//
// Read-only by design: this router has no POST, no form, and no write path
// other than a fire-and-forget view counter. Nothing here can send email.
export const previewRouter = Router()

previewRouter.get('/:token', async (req, res) => {
  res.set('X-Robots-Tag', 'noindex, nofollow')

  const preview = await getPreviewByToken(req.params.token)
  if (!preview || !isPreviewActive(preview)) return res.status(404).type('text/plain').send('Not found')

  const prospect = await getProspect(preview.prospectId)
  if (!prospect) return res.status(404).type('text/plain').send('Not found')

  const [mockup, crawl] = await Promise.all([
    preview.mockupId ? getMockup(preview.mockupId) : Promise.resolve(null),
    preview.crawlId ? getAdhocCrawl(preview.crawlId) : Promise.resolve(null)
  ])

  recordView(preview.id).catch(() => {}) // never let a counter write break the page

  const html = renderPreviewPage({
    prospect,
    format: mockup?.format ?? 'html',
    conceptUrl: mockup?.format === 'html' ? `/p/${preview.previewToken}/site` : null,
    imageUrl: mockup?.format === 'image' ? `/p/${preview.previewToken}/image` : null,
    currentScreenshotUrl: mockup?.currentScreenshotPath ? `/p/${preview.previewToken}/current` : null,
    onpageScore: crawl?.onpageScore ?? null,
    issues: crawl?.issues ?? [],
    bookingUrl: process.env.PROSPECT_BOOKING_URL ?? null
  })
  res.type('html').send(html)
})

// The generated concept itself, iframed by the wrapper above and openable
// full-screen. The CSP is the real guard here: the document is model-authored,
// so it is served with no ability to make network requests of any kind beyond
// loading images. Even if generation ignored the "self-contained" instruction,
// the page cannot phone home from the prospect's browser.
previewRouter.get('/:token/site', async (req, res) => {
  const preview = await getPreviewByToken(req.params.token)
  if (!preview || !isPreviewActive(preview) || !preview.mockupId) {
    return res.status(404).type('text/plain').send('Not found')
  }

  const mockup = await getMockup(preview.mockupId)
  if (!mockup?.html) return res.status(404).type('text/plain').send('Not found')

  res
    .set('X-Robots-Tag', 'noindex, nofollow')
    .set('Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; script-src 'unsafe-inline'")
    .type('html')
    .send(mockup.html)
})

// Served from our own origin rather than a Supabase signed URL: signed URLs
// expire (a prospect opens the email days later) and a *.supabase.co link
// reads as phishing in a cold email. This one is revocable and view-tracked.
previewRouter.get('/:token/image', async (req, res) => {
  const preview = await getPreviewByToken(req.params.token)
  if (!preview || !isPreviewActive(preview) || !preview.mockupId) {
    return res.status(404).type('text/plain').send('Not found')
  }

  const mockup = await getMockup(preview.mockupId)
  if (!mockup?.storagePath) return res.status(404).type('text/plain').send('Not found')

  try {
    const buffer = await getMockupImage(mockup.storagePath)
    res.set('X-Robots-Tag', 'noindex, nofollow').type('png').send(buffer)
  } catch {
    res.status(404).type('text/plain').send('Not found')
  }
})

// The prospect's current site, for the before/after.
previewRouter.get('/:token/current', async (req, res) => {
  const preview = await getPreviewByToken(req.params.token)
  if (!preview || !isPreviewActive(preview) || !preview.mockupId) {
    return res.status(404).type('text/plain').send('Not found')
  }

  const mockup = await getMockup(preview.mockupId)
  if (!mockup?.currentScreenshotPath) return res.status(404).type('text/plain').send('Not found')

  try {
    const buffer = await getScreenshotImage(mockup.currentScreenshotPath)
    res.set('X-Robots-Tag', 'noindex, nofollow').type('png').send(buffer)
  } catch {
    res.status(404).type('text/plain').send('Not found')
  }
})
