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

// Reads getComputedStyle() on the elements that actually carry a site's brand
// identity — header/nav background, the most prominent call-to-action, and
// body text/links — rather than grepping raw CSS text. This is what makes it
// work regardless of how the colors are authored: Tailwind utility classes,
// an external stylesheet, CSS-in-JS, or inline style attributes all resolve
// to the same computed rgb() value, whereas a text-based regex only catches
// hand-written CSS custom properties. Near-white/near-black/near-transparent
// values are dropped since they're layout chrome, not brand color. Returns a
// bounding box for the best logo <img> candidate (if any) so the caller can
// screenshot just that element — a business's actual logo, not a meta-tag
// guess — alongside its resolved src for the generated page to load live.
const EXTRACT_BRAND_SIGNALS = `
  (() => {
    function toHex(rgbStr) {
      if (!rgbStr) return null
      const m = rgbStr.match(/rgba?\\(([^)]+)\\)/)
      if (!m) return null
      const parts = m[1].split(',').map(s => parseFloat(s.trim()))
      const [r, g, b, a] = parts
      if ([r, g, b].some(v => Number.isNaN(v))) return null
      if (a !== undefined && a < 0.25) return null
      if (r > 245 && g > 245 && b > 245) return null
      if (r < 12 && g < 12 && b < 12) return null
      return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
    }
    const colors = new Set()
    function sample(el, props) {
      if (!el) return
      const cs = getComputedStyle(el)
      for (const p of props) {
        const hex = toHex(cs[p])
        if (hex) colors.add(hex)
      }
    }
    sample(document.querySelector('header, nav, [class*="header" i], [class*="navbar" i]'), ['backgroundColor'])
    sample(document.querySelector('button, a[class*="btn" i], a[class*="button" i], [class*="cta" i]'), ['backgroundColor', 'color'])
    sample(document.querySelector('a'), ['color'])
    sample(document.body, ['backgroundColor', 'color'])

    const logoCandidates = document.querySelectorAll(
      'header img, nav img, [class*="header" i] img, [class*="logo" i] img, img[class*="logo" i], img[alt*="logo" i], img[src*="logo" i]'
    )
    let logo = null
    for (const img of [...logoCandidates, document.querySelector('img')]) {
      if (!img || !img.src) continue
      const rect = img.getBoundingClientRect()
      if (rect.width < 16 || rect.height < 16) continue
      logo = { src: img.src, x: Math.max(0, rect.x), y: Math.max(0, rect.y), width: rect.width, height: rect.height }
      break
    }

    // Real content photos — hero shots, crew/job photos, service imagery —
    // so the concept can reuse the business's ACTUAL images instead of only
    // CSS gradients/shapes. Filtered to rendered size (excludes icons, small
    // decorative assets, tracking pixels) and deduped; the logo is excluded
    // since it's handled separately above.
    const photos = []
    // Partner/manufacturer/supplier logo strips — e.g. "Proud to use products
    // from GAF, Owens Corning" — are real assets the business already hosts,
    // same provenance as the photos below, so worth keeping rather than
    // discarding: a generated concept can reuse them as a small trust strip.
    // Kept SEPARATE from photos, not merged in: mixing them into the photo
    // pool produces a row of stretched, mangled wordmarks where a real photo
    // was expected, which is exactly the bug this container check used to
    // exist to prevent.
    const partnerLogos = []
    const seen = new Set()
    for (const img of document.querySelectorAll('img')) {
      if (!img.src || seen.has(img.src)) continue
      if (logo && img.src === logo.src) continue
      const rect = img.getBoundingClientRect()
      if (rect.width < 200 || rect.height < 150) continue

      // Reject by container context and by the wide-and-short aspect ratio
      // that badges/banners have and real photos don't.
      const ctx = ((img.closest('[class*="partner" i], [class*="sponsor" i], [class*="brand" i], [class*="logo" i], [class*="carousel" i], [class*="marquee" i]') ? 'x' : '') +
        ' ' + (img.className || '') + ' ' + (img.alt || '') + ' ' + img.src).toLowerCase()
      const looksLikePartnerLogo = /partner|sponsor|logo|badge|certif|award|affiliat/.test(ctx)

      // Wide-and-short or thin-and-tall means a banner/strip, not a photo.
      // naturalWidth/Height is the true file aspect, not the CSS-scaled box.
      const ratio = (img.naturalWidth || rect.width) / (img.naturalHeight || rect.height)

      if (looksLikePartnerLogo) {
        seen.add(img.src)
        if (partnerLogos.length < 8) partnerLogos.push(img.src)
        continue
      }
      if (ratio > 3 || ratio < 0.4) continue

      seen.add(img.src)
      photos.push(img.src)
      if (photos.length >= 6) break
    }

    return { colors: [...colors].slice(0, 6), logo, photos, partnerLogos }
  })()`

interface BrandSignals {
  colors: string[]
  logo: { src: string; x: number; y: number; width: number; height: number } | null
  photos: string[]
  partnerLogos: string[]
}

export interface BrandSnapshot {
  screenshot: Buffer
  colors: string[]
  logoUrl: string | null
  // A tight crop of just the logo element, when one was found — sent to
  // Claude as its own image so the wordmark is actually legible instead of
  // being a few illegible pixels inside a full 1440px-wide page screenshot.
  logoCrop: Buffer | null
  // Real photo URLs found on the current site (hero/service/crew shots) —
  // lets the generated concept reuse actual imagery instead of being limited
  // to CSS gradients and shapes for everything.
  photoUrls: string[]
  // Real partner/material-supplier logo URLs (e.g. a "products we use" strip)
  // — same real-asset provenance as photoUrls, kept separate because they're
  // used differently: a small trust-badge row, not hero/service imagery.
  partnerLogoUrls: string[]
}

async function capturePageAndBrand(page: import('playwright').Page, url: string): Promise<BrandSnapshot> {
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

  const signals = await page.evaluate(EXTRACT_BRAND_SIGNALS).catch(() => null) as BrandSignals | null

  // Crop before the full-page screenshot below — triggerLazyLoading already
  // scrolled back to the top, so the logo (almost always near the top of the
  // DOM) is still within the viewport clip coordinates evaluate() measured.
  let logoCrop: Buffer | null = null
  if (signals?.logo) {
    try {
      logoCrop = await page.screenshot({
        type: 'png',
        clip: {
          x: signals.logo.x, y: signals.logo.y,
          width: signals.logo.width, height: signals.logo.height
        }
      }) as Buffer
    } catch {
      logoCrop = null
    }
  }

  const height = await pageHeight(page)
  const screenshot = height > MAX_FULL_PAGE_HEIGHT
    ? await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: VIEWPORT_WIDTH, height: MAX_FULL_PAGE_HEIGHT } })
    : await page.screenshot({ type: 'png', fullPage: true })

  return {
    screenshot: screenshot as Buffer,
    colors: signals?.colors ?? [],
    logoUrl: signals?.logo?.src ?? null,
    logoCrop,
    photoUrls: signals?.photos ?? [],
    partnerLogoUrls: signals?.partnerLogos ?? []
  }
}

export async function captureUrl(rawUrl: string): Promise<Buffer> {
  const url = assertPublicUrl(rawUrl)
  return withPage(page => capturePageAndBrand(page, url).then(r => r.screenshot))
}

// One page load does triple duty: the before/after screenshot, computed-style
// color extraction, and logo detection + crop — see capturePageAndBrand above.
// Deliberately one network round trip rather than three separate ones.
export async function captureBrandSnapshot(rawUrl: string): Promise<BrandSnapshot> {
  const url = assertPublicUrl(rawUrl)
  return withPage(page => capturePageAndBrand(page, url))
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

// ── Layout audit ─────────────────────────────────────────────────────────────
// Catches the two alignment defects that kept surviving prompt rules and were
// only ever found by eye: an icon badge whose optical centre doesn't match the
// heading beside it, and a nav link group that isn't actually centred. Both are
// invisible in markup and obvious on screen, which is exactly the combination
// worth measuring rather than reviewing.
//
// Reports; never rewrites. The generated document stays exactly as the model
// produced it — findings surface in the dashboard so a bad concept is caught
// before it reaches a prospect, not silently patched behind the operator.

export interface LayoutFinding {
  kind: 'icon-heading' | 'nav-centring'
  label: string
  // Pixels the element is off by, signed: positive means low (icon rows) or
  // right (nav), negative the other way.
  delta: number
  viewport: number
}

// Two measurements that both need care:
//   * headings are compared on their FIRST LINE box (via Range.getClientRects),
//     not their bounding box — a heading that wraps is taller than one line, so
//     an icon correctly pinned to line one would otherwise read as misaligned
//     by half the overflow.
//   * icons are matched to headings geometrically rather than by DOM structure,
//     because the model nests wrappers differently every generation.
const AUDIT_ALIGNMENT = `(() => {
  const out = [];
  const icons = [...document.querySelectorAll('svg')].map(svg => {
    const box = svg.closest('div,span,a,li') || svg;
    return { r: box.getBoundingClientRect() };
  }).filter(i => i.r.width > 0 && i.r.width <= 88 && i.r.height <= 88);

  document.querySelectorAll('h1,h2,h3,h4,h5,h6,strong,b').forEach(h => {
    const box = h.getBoundingClientRect();
    if (!box.height) return;
    const range = document.createRange();
    range.selectNodeContents(h);
    const rects = [...range.getClientRects()].filter(r => r.height > 0);
    const hr = rects.length ? rects[0] : box;
    const icon = icons.find(i =>
      i.r.right <= hr.left + 2 &&
      hr.left - i.r.right < 40 &&
      i.r.bottom > hr.top - 30 &&
      i.r.top < hr.bottom + 30);
    if (!icon) return;
    const delta = (hr.top + hr.height / 2) - (icon.r.top + icon.r.height / 2);
    if (Math.abs(delta) <= 2) return;
    out.push({ kind: 'icon-heading', label: (h.textContent || '').trim().slice(0, 40), delta: +delta.toFixed(1) });
  });

  const nav = document.querySelector('nav, .nav, header nav, header');
  const links = nav && nav.querySelector('.nav-links, ul, .links');
  if (nav && links && getComputedStyle(links).display !== 'none') {
    const nr = nav.getBoundingClientRect(), lr = links.getBoundingClientRect();
    if (lr.width > 0) {
      const off = (lr.left + lr.width / 2) - (nr.left + nr.width / 2);
      if (Math.abs(off) > 2) {
        out.push({ kind: 'nav-centring', label: 'nav link group', delta: +off.toFixed(1) });
      }
    }
  }
  return out;
})()`

// Checked across several widths deliberately: the nav grid is symmetric at
// desktop sizes but drifts once the header gets crowded, and headings only wrap
// at narrow ones — a single 1440px pass misses both.
const AUDIT_VIEWPORTS = [1440, 1024, 900, 800, 640, 390]

export async function auditConceptLayout(html: string): Promise<LayoutFinding[]> {
  const browser = await getBrowser()
  const findings: LayoutFinding[] = []
  for (const width of AUDIT_VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })
    try {
      const page = await context.newPage()
      await page.setContent(html, { waitUntil: 'load', timeout: RENDER_TIMEOUT_MS })
      await page.waitForTimeout(150)
      const found = await page.evaluate(AUDIT_ALIGNMENT) as Omit<LayoutFinding, 'viewport'>[]
      for (const f of found) findings.push({ ...f, viewport: width })
    } catch {
      // An audit that fails must never sink a generation that already cost money.
    } finally {
      await context.close().catch(() => {})
    }
  }
  return findings
}
