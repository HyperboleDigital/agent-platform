import { complete } from './llm/complete'
import { getCrawl } from './dataforseo'
import { getClientById } from './clients'
import { createRequest, type ChangeRequest } from './change-requests'

// Phase 2 of the SEO-automation plan: turn crawl issues into concrete,
// Claude-generated fixes delivered as one-click change requests. First fix
// type = page titles + meta descriptions (pure text, cheap, high-value). More
// types (alt text via vision, JSON-LD schema, etc.) slot in alongside this.
//
// Generation (draftMetaFixes) is deliberately side-effect-free so it can be
// verified without creating requests or firing notifications; delivery
// (createMetaFixRequest) wraps it and persists.

// Problem keys whose fix is a rewritten title and/or meta description.
const TITLE_DESC_KEYS = [
  'no_title', 'title_too_short', 'title_too_long', 'irrelevant_title',
  'no_description', 'duplicate_description', 'irrelevant_description',
]
const MAX_FIX_PAGES = 8

export interface MetaFixItem {
  url: string
  currentTitle: string
  suggestedTitle: string
  currentDescription: string
  suggestedDescription: string
}

export interface MetaFixDraft {
  crawlId: string
  items: MetaFixItem[]
}

interface PageMeta { url: string; title: string; description: string; snippet: string }

// Crude HTML → {title, meta description, visible-text snippet}. Good enough to
// ground a rewrite; we're not building a full parser. Fetch failures are skipped.
async function fetchPageMeta(url: string): Promise<PageMeta | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'HyperboleSEO/1.0' } })
    if (!res.ok) return null
    const html = await res.text()
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? ''
    const description = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1]?.trim()
      ?? html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1]?.trim() ?? ''
    const body = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return { url, title, description, snippet: body.slice(0, 700) }
  } catch {
    return null
  }
}

// The affected URLs for title/description problems, de-duped and capped.
function targetUrls(crawl: NonNullable<Awaited<ReturnType<typeof getCrawl>>>): string[] {
  const urls = new Set<string>()
  for (const p of crawl.checks ?? []) {
    if (TITLE_DESC_KEYS.includes(p.key)) for (const u of p.urls) urls.add(u)
  }
  return [...urls].slice(0, MAX_FIX_PAGES)
}

export async function draftMetaFixes(clientId: string, crawlId: string): Promise<MetaFixDraft> {
  const crawl = await getCrawl(clientId, crawlId)
  if (!crawl) throw new Error('Crawl not found')
  if (crawl.status !== 'finished') throw new Error('Crawl has not finished yet')

  const urls = targetUrls(crawl)
  if (urls.length === 0) throw new Error('No title or meta-description issues to fix in this crawl')

  const pages = (await Promise.all(urls.map(fetchPageMeta))).filter((p): p is PageMeta => !!p)
  if (pages.length === 0) throw new Error('Could not fetch any of the affected pages')

  const input = pages.map((p, i) => `#${i} URL: ${p.url}
Current title: ${p.title || '(none)'}
Current meta description: ${p.description || '(none)'}
Page content: ${p.snippet}`).join('\n\n')

  const prompt = `You are an SEO editor. For each page below, write an improved SEO title tag and meta description, grounded ONLY in that page's actual content (do not invent facts or offers).
Rules: title ≤ 60 characters, specific and compelling; meta description ≤ 155 characters, action-oriented, includes the page's core topic. No clickbait, no ALL CAPS, no quotes around the text.

${input}

Return ONLY a JSON array (no prose, no code fences), one object per page, in the same order:
[{"index": number, "title": string, "description": string}]`

  let suggestions: { index: number; title: string; description: string }[] = []
  const raw = await complete(prompt, { maxTokens: 1200, tier: 'cheap' })
  const match = raw.match(/\[[\s\S]*\]/)
  if (match) {
    try {
      const parsed = JSON.parse(match[0])
      if (Array.isArray(parsed)) suggestions = parsed
    } catch { /* fall through to empty */ }
  }
  if (suggestions.length === 0) throw new Error('Fix generation returned nothing usable — try again')

  const byIndex = new Map(suggestions.map(s => [Number(s.index), s]))
  const items: MetaFixItem[] = pages.map((p, i) => {
    const s = byIndex.get(i)
    return {
      url: p.url,
      currentTitle: p.title,
      suggestedTitle: s?.title?.trim() ?? '',
      currentDescription: p.description,
      suggestedDescription: s?.description?.trim() ?? '',
    }
  }).filter(it => it.suggestedTitle || it.suggestedDescription)

  return { crawlId, items }
}

function toMarkdown(items: MetaFixItem[]): string {
  const blocks = items.map(it => `### ${it.url}
- **Suggested title:** ${it.suggestedTitle || '—'}
  - _Current:_ ${it.currentTitle || '(none)'}
- **Suggested meta description:** ${it.suggestedDescription || '—'}
  - _Current:_ ${it.currentDescription || '(none)'}`).join('\n\n')
  return `Auto-generated title & meta-description fixes for ${items.length} page(s) from the latest SEO crawl. Review, then apply to your site.\n\n${blocks}`
}

export async function createMetaFixRequest(clientId: string, crawlId: string, createdBy: string | null): Promise<{ request: ChangeRequest; count: number }> {
  const draft = await draftMetaFixes(clientId, crawlId)
  const title = `SEO fix: titles & meta descriptions (${draft.items.length} page${draft.items.length === 1 ? '' : 's'})`
  const request = await createRequest(clientId, title, toMarkdown(draft.items), createdBy)
  return { request, count: draft.items.length }
}

// ── Fix type 2: schema.org structured data (JSON-LD) ─────────────────────────
// Pure text, directly serves GEO/AEO (machine-readability + citation). Operates
// on the client's key pages, not crawl-specific issues, so it needs no paid
// crawl to run — free to verify. Grounded strictly in real page content.
const MAX_SCHEMA_PAGES = 4

export interface SchemaFixItem { url: string; type: string; jsonld: string }
export interface SchemaFixDraft { items: SchemaFixItem[] }

function keyPages(seoPages: string[] | undefined, domain: string | undefined): string[] {
  const pages = seoPages?.length
    ? seoPages
    : domain
      ? [domain.startsWith('http') ? domain : `https://${domain}`]
      : []
  return pages.slice(0, MAX_SCHEMA_PAGES)
}

export async function draftSchemaFixes(clientId: string): Promise<SchemaFixDraft> {
  const client = await getClientById(clientId)
  if (!client) throw new Error('Client not found')
  const urls = keyPages(client.portalConfig?.seoPages, client.domain)
  if (urls.length === 0) throw new Error('No pages configured — set a domain or SEO pages first')

  const items: SchemaFixItem[] = []
  for (const url of urls) {
    const meta = await fetchPageMeta(url)
    if (!meta) continue
    const prompt = `Generate schema.org structured data (JSON-LD) for this web page.
Use ONLY official schema.org @types — e.g. Organization, LocalBusiness, WebSite, WebPage, Article, BlogPosting, Product, Service, CreativeWork, BreadcrumbList, FAQPage. Never invent a custom type (e.g. "Project" is NOT valid).
Pick the best fit: Organization/LocalBusiness for a homepage/about/contact page; Article/BlogPosting for a post; Product for a product page; CreativeWork or Article for a portfolio/case-study page.
Ground every field in the content below. Do NOT invent phone numbers, addresses, emails, prices, ratings, review counts, OR urls/image/logo paths — include a URL only if it appears verbatim in the content, otherwise omit that field entirely.
URL: ${meta.url}
Title: ${meta.title}
Meta description: ${meta.description}
Content: ${meta.snippet}

Return ONLY a single valid JSON object with "@context" and "@type" (no prose, no code fences, no <script> tag).`
    const raw = await complete(prompt, { maxTokens: 800, tier: 'cheap' })
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) continue
    let obj: any
    try { obj = JSON.parse(match[0]) } catch { continue }
    if (!obj || !obj['@type']) continue
    const type = Array.isArray(obj['@type']) ? obj['@type'].join(', ') : String(obj['@type'])
    items.push({ url: meta.url, type, jsonld: JSON.stringify(obj, null, 2) })
  }
  if (items.length === 0) throw new Error('Could not generate schema for any page')
  return { items }
}

function schemaMarkdown(items: SchemaFixItem[]): string {
  const blocks = items.map(it => `### ${it.url}
Type: **${it.type}**. Paste inside the page's \`<head>\` in a \`<script type="application/ld+json">\` tag:

\`\`\`json
${it.jsonld}
\`\`\``).join('\n\n')
  return `Auto-generated schema.org structured data (JSON-LD) for ${items.length} page(s). Structured data helps Google and AI engines understand and cite your pages.\n\n${blocks}`
}

export async function createSchemaFixRequest(clientId: string, createdBy: string | null): Promise<{ request: ChangeRequest; count: number }> {
  const draft = await draftSchemaFixes(clientId)
  const title = `SEO fix: schema markup (${draft.items.length} page${draft.items.length === 1 ? '' : 's'})`
  const request = await createRequest(clientId, title, schemaMarkdown(draft.items), createdBy)
  return { request, count: draft.items.length }
}
