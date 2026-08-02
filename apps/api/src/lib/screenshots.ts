import { chromium, type Browser } from 'playwright'
import { isPublicHost, normalizeDomain } from '@agent-platform/shared'

// Headless Chromium for two jobs in the prospecting flow:
//   1. capture a prospect's CURRENT site, for the before/after on the preview
//   2. render a GENERATED concept to a PNG, for pasting into an email
//
// One browser process is shared across all calls and kept alive. Launching per
// request is the usual cause of memory death on a small instance — each launch
// is ~50MB RSS and several hundred ms. Contexts are cheap and disposable; the
// browser is not.

const NAV_TIMEOUT_MS = 20_000
const RENDER_TIMEOUT_MS = 10_000
const VIEWPORT_WIDTH = 1440
const VIEWPORT_HEIGHT = 900

// Past this a page is almost certainly an infinite-scroll feed rather than a
// homepage, and the PNG gets too large to hand to a vision model.
const MAX_FULL_PAGE_HEIGHT = 6000

let browserPromise: Promise<Browser> | null = null

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({ args: ['--disable-dev-shm-usage'] })
    // A failed launch must not poison the cached promise — otherwise one bad
    // start (missing system libs, OOM) disables screenshots until restart.
    browserPromise.catch(() => { browserPromise = null })
  }
  return browserPromise
}

export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return
  const browser = await browserPromise.catch(() => null)
  browserPromise = null
  await browser?.close().catch(() => {})
}

// Chromium ships with the container image but can be absent locally if
// `playwright install` was never run. Probing keeps a missing browser a
// disabled feature rather than a 500 mid-generation.
export async function screenshotsConfigured(): Promise<boolean> {
  try {
    await getBrowser()
    return true
  } catch {
    return false
  }
}

// Same SSRF posture as fetchHomepage() in prospect-mockups.ts: the target URL
// originates from Google Places, but it still reaches a server-side network
// call, and a browser follows redirects far more eagerly than fetch does.
function assertPublicUrl(raw: string): string {
  const url = raw.startsWith('http') ? raw : `https://${raw}`
  let host: string
  try { host = new URL(url).hostname } catch { throw new Error('Invalid URL') }
  if (!isPublicHost(normalizeDomain(host))) throw new Error('Refusing to screenshot a private or local address')
  return url
}

async function withPage<T>(fn: (page: import('playwright').Page) => Promise<T>): Promise<T> {
  const browser = await getBrowser()
  const context = await browser.newContext({
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    deviceScaleFactor: 1,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    acceptDownloads: false
  })
  try {
    return await fn(await context.newPage())
  } finally {
    await context.close().catch(() => {})
  }
}

// These run in the browser, not in Node. Passed as source strings rather than
// callbacks so this package's tsconfig doesn't need the DOM lib — adding it
// would let genuine server-side code reference `document` and still typecheck.
const SCROLL_TO_TRIGGER_LAZY_LOAD = `
  new Promise(resolve => {
    let y = 0
    const step = () => {
      y += window.innerHeight
      window.scrollTo(0, y)
      if (y < document.body.scrollHeight && y < 12000) setTimeout(step, 120)
      else { window.scrollTo(0, 0); setTimeout(resolve, 400) }
    }
    step()
  })`

const PAGE_HEIGHT = 'document.body.scrollHeight'

// Lazy-loaded imagery is the norm on the sites being captured, and a homepage
// screenshot missing every image below the fold is worse than useless for a
// before/after. Scroll to the bottom to trigger it, then return to the top.
async function triggerLazyLoading(page: import('playwright').Page): Promise<void> {
  await page.evaluate(SCROLL_TO_TRIGGER_LAZY_LOAD).catch(() => {})
}

async function pageHeight(page: import('playwright').Page): Promise<number> {
  const height = await page.evaluate(PAGE_HEIGHT).catch(() => VIEWPORT_HEIGHT)
  return typeof height === 'number' ? height : VIEWPORT_HEIGHT
}

export async function captureUrl(rawUrl: string): Promise<Buffer> {
  const url = assertPublicUrl(rawUrl)

  return withPage(async page => {
    // 'domcontentloaded' rather than 'networkidle': marketing sites routinely
    // keep analytics beacons and chat widgets open forever, so networkidle
    // reliably burns the full timeout on exactly the sites we care about.
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT_MS })

    // Re-check after redirects — a 3xx can land somewhere private.
    const finalHost = new URL(page.url()).hostname
    if (!isPublicHost(normalizeDomain(finalHost))) throw new Error('Redirected to a private address')
    if (response && response.status() >= 400) throw new Error(`Site returned ${response.status()}`)

    await page.waitForTimeout(1200)
    await triggerLazyLoading(page)

    const height = await pageHeight(page)
    if (height > MAX_FULL_PAGE_HEIGHT) {
      return page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: MAX_FULL_PAGE_HEIGHT } })
    }
    return page.screenshot({ type: 'png', fullPage: true })
  })
}

// Renders a generated concept to a PNG. setContent with a null base URL means
// relative asset paths can't resolve, which is intentional — generated pages
// are self-contained by construction.
export async function captureHtml(html: string): Promise<Buffer> {
  return withPage(async page => {
    await page.setContent(html, { waitUntil: 'load', timeout: RENDER_TIMEOUT_MS })
    await page.waitForTimeout(600)

    const height = await pageHeight(page)
    if (height > MAX_FULL_PAGE_HEIGHT) {
      return page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: MAX_FULL_PAGE_HEIGHT } })
    }
    return page.screenshot({ type: 'png', fullPage: true })
  })
}
