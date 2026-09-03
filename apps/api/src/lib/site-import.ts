import { isPublicHost } from '@agent-platform/shared'
import { addDocument, listDocuments, deleteDocument } from '../tools/knowledge-base'

// Imports a client's own website into their knowledge base: discovers pages
// (sitemap first, homepage links as fallback), extracts readable text, and
// stores one knowledge_base document per page with its URL — so the chat's
// retrieved chunks cite the exact page they came from ("Source: …" in
// tools/knowledge-base format()).
//
// Re-running is a refresh, not a duplicate: a page whose URL already has an
// imported document replaces it. Only documents this importer created are
// replaced — uploads and pasted text are never touched (see IMPORT_TAG).

// Marks importer-created documents so a re-import knows which ones it owns.
// Matching on description (not url alone) means an operator who pasted text
// and set the same source URL never gets their document silently replaced.
export const IMPORT_TAG = 'Imported from website'

const PAGE_TIMEOUT_MS = 8000
const MAX_PAGE_CHARS = 20_000   // ~a long page; chunkText splits it further
const MIN_PAGE_CHARS = 200      // skip stubs/redirect shells with no real copy
const FETCH_CONCURRENCY = 4
export const DEFAULT_MAX_PAGES = 20
export const MAX_MAX_PAGES = 40

const USER_AGENT = 'HyperboleKB/1.0 (+https://hyperboledigital.com)'

// File extensions a sitemap/homepage can link to that will never extract as
// HTML text — filtered during discovery so they don't burn page slots.
const NON_HTML_RE = /\.(pdf|jpe?g|png|gif|svg|webp|ico|css|js|mp4|webm|mp3|zip|xml|txt|woff2?)(\?|#|$)/i

export interface ImportedPage {
  url: string
  title: string
  chunks: number
  replaced: boolean
}

export interface SiteImportResult {
  pages: ImportedPage[]
  // Pages fetched but not imported (non-HTML, too little text, fetch failed).
  skipped: number
  // How the page list was found — surfaced in the dashboard toast so a thin
  // import ("only 3 pages?") is explainable at a glance.
  discovery: 'sitemap' | 'homepage-links' | 'homepage-only'
}

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PAGE_TIMEOUT_MS)
  try {
    return await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml,application/xml' },
      redirect: 'follow',
      signal: ctrl.signal
    })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function fetchText(url: string): Promise<string | null> {
  const res = await fetchWithTimeout(url)
  if (!res?.ok) return null
  try { return await res.text() } catch { return null }
}

// ── Discovery ───────────────────────────────────────────────────────────────

function locsFromSitemapXml(xml: string): string[] {
  return Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map(m => m[1])
}

// Sitemap URLs for `base`, following one level of sitemap-index nesting (the
// common "sitemap.xml points at post-sitemap.xml + page-sitemap.xml" layout).
async function urlsFromSitemap(base: URL): Promise<string[]> {
  const robots = await fetchText(new URL('/robots.txt', base).href)
  const fromRobots = (robots ?? '')
    .split('\n')
    .map(l => l.split('#')[0].trim().match(/^sitemap:\s*(\S+)/i)?.[1])
    .filter((u): u is string => !!u)
  const candidates = fromRobots.length ? fromRobots : [new URL('/sitemap.xml', base).href]

  for (const sitemapUrl of candidates) {
    const xml = await fetchText(sitemapUrl)
    if (!xml) continue
    const locs = locsFromSitemapXml(xml)
    if (!locs.length) continue
    if (!xml.includes('<sitemapindex')) return locs
    // Index of sitemaps: pull each child until we have plenty to choose from.
    const nested: string[] = []
    for (const child of locs.slice(0, 5)) {
      const childXml = await fetchText(child)
      if (childXml) nested.push(...locsFromSitemapXml(childXml))
      if (nested.length >= MAX_MAX_PAGES * 3) break
    }
    if (nested.length) return nested
  }
  return []
}

// Same-origin links from the homepage — the fallback for sites with no
// sitemap. Nav/footer links land here too, which is fine: those ARE the
// pages a visitor asks the assistant about.
function urlsFromHomepageLinks(html: string, base: URL): string[] {
  const urls = new Set<string>()
  for (const m of html.matchAll(/<a[^>]+href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], base)
      if (u.host !== base.host) continue
      u.hash = ''
      urls.add(u.href)
    } catch { /* unparsable href */ }
  }
  return Array.from(urls)
}

// ── Extraction ──────────────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
}

export function extractPage(html: string, url: string): { title: string; text: string } | null {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Block-level closers become newlines so headings/paragraphs don't fuse
    // into one unreadable line; everything else collapses to spaces.
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)[^>]*>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
  const text = decodeEntities(body)
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_PAGE_CHARS)
  if (text.length < MIN_PAGE_CHARS) return null

  const title = decodeEntities(titleMatch?.[1] ?? '').replace(/\s+/g, ' ').trim()
    || new URL(url).pathname.replace(/\/$/, '').split('/').pop()
    || 'Homepage'
  return { title, text }
}

// ── Import ──────────────────────────────────────────────────────────────────

export async function importWebsite(
  clientId: string,
  siteUrl: string,
  maxPages: number = DEFAULT_MAX_PAGES
): Promise<SiteImportResult> {
  const base = new URL(/^https?:\/\//i.test(siteUrl) ? siteUrl : `https://${siteUrl}`)
  // Same guard the domain save uses — this endpoint makes the server fetch an
  // operator-supplied URL, so internal hosts are off the table regardless of
  // who's asking.
  if (!isPublicHost(base.hostname)) throw new Error('Not a public website host')
  const limit = Math.max(1, Math.min(MAX_MAX_PAGES, Math.floor(maxPages)))

  // 1. Discover candidate pages. The homepage always leads: it's the page
  // most likely to describe what the business actually does.
  let discovery: SiteImportResult['discovery'] = 'sitemap'
  let candidates = await urlsFromSitemap(base)
  let homepageHtml: string | null = null
  if (!candidates.length) {
    homepageHtml = await fetchText(base.href)
    if (homepageHtml) {
      candidates = urlsFromHomepageLinks(homepageHtml, base)
      discovery = candidates.length ? 'homepage-links' : 'homepage-only'
    } else {
      discovery = 'homepage-only'
    }
  }
  const seen = new Set<string>()
  const pageUrls = [base.href, ...candidates]
    .filter(u => {
      try {
        const parsed = new URL(u)
        if (parsed.host !== base.host || NON_HTML_RE.test(parsed.pathname + parsed.search)) return false
        const key = parsed.href.replace(/\/$/, '')
        if (seen.has(key)) return false
        seen.add(key)
        return true
      } catch { return false }
    })
    .slice(0, limit)

  // 2. Which URLs already have an imported document (for replace-on-refresh).
  const existing = await listDocuments(clientId)
  const importedByUrl = new Map(
    existing
      .filter(d => d.url && !d.fileId && d.description === IMPORT_TAG)
      .map(d => [d.url as string, d.id])
  )

  // 3. Fetch + extract + store, a few pages at a time.
  const pages: ImportedPage[] = []
  let skipped = 0
  const queue = [...pageUrls]
  async function worker() {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      const html = url === base.href && homepageHtml ? homepageHtml : await fetchText(url)
      const extracted = html ? extractPage(html, url) : null
      if (!extracted) { skipped++; continue }
      const previous = importedByUrl.get(url)
      if (previous) await deleteDocument(clientId, previous)
      const { ids } = await addDocument(clientId, extracted.title, extracted.text, { url, description: IMPORT_TAG })
      pages.push({ url, title: extracted.title, chunks: ids.length, replaced: !!previous })
    }
  }
  await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, worker))

  return { pages, skipped, discovery }
}
