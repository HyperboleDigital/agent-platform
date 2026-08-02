import { randomUUID } from 'crypto'
import { isPublicHost, normalizeDomain } from '@agent-platform/shared'
import { supabase } from './supabase'
import { getProspect, type Prospect } from './prospecting'
import { completeWithImages, type VisionImage, type VisionMediaType } from './llm/complete'
import { selectReferencesForVertical, getReferenceImage, type DesignReference } from './design-references'
import { captureUrl, screenshotsConfigured } from './screenshots'

// Prospecting — a generated "here's what your homepage could look like"
// concept, sent to a prospect as a real, scrollable page.
//
// This used to generate an IMAGE (gpt-image-1, 1536x1024). That capped quality
// no matter how the prompt was tuned: a single landscape image cannot have
// below-fold content, image models garble nav bars and body text, and a flat
// PNG can't carry the prospect's actual logo or be hand-tweaked. Concepts are
// now HTML documents written by a vision model.
//
// Design direction comes from the operator's design_references library, NOT
// from the model's own taste — see lib/design-references.ts. With an empty
// library there is nothing to imitate, which is why that ships first.
//
// Still NO send path anywhere here: the operator pastes the preview link into
// the email they send themselves.

const BUCKET = 'prospect-mockups'
const SCREENSHOT_BUCKET = 'prospect-screenshots'
const FETCH_TIMEOUT_MS = 8000

// A full page with seven sections runs well past the 800-token default.
const HTML_MAX_TOKENS = 16000

export function mockupsConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

// ── Brand extraction ─────────────────────────────────────────────────────────
// Grounds the image prompt in what the business actually is, so the concept
// isn't generic. Regex rather than a DOM parser: main has no HTML-parsing
// dependency and this needs ~8 fields, matching the same trade-off
// fetchHomepageHook() in lib/prospecting.ts already makes.

export interface ExtractedBrand {
  businessName: string | null
  headline: string | null
  services: string[]
  phone: string | null
  colors: string[]
  logoUrl: string | null
}

function absolutize(url: string, base: string): string | null {
  try { return new URL(url, base).toString() } catch { return null }
}

function firstMatch(html: string, re: RegExp): string | null {
  const m = html.match(re)
  return m?.[1]?.trim() || null
}

// Same SSRF posture as lib/dataforseo.ts: reject loopback/private targets
// before fetching. The prospect's website comes from Google Places, but it's
// still remote-controlled input reaching a server-side fetch.
async function fetchHomepage(website: string): Promise<{ html: string; finalUrl: string } | null> {
  const url = website.startsWith('http') ? website : `https://${website}`
  let host: string
  try { host = new URL(url).hostname } catch { return null }
  if (!isPublicHost(normalizeDomain(host))) return null

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'HyperboleProspecting/1.0' }
    })
    clearTimeout(timeout)
    if (!res.ok) return null
    // Re-check after redirects — a 3xx can land somewhere private.
    const finalHost = new URL(res.url).hostname
    if (!isPublicHost(normalizeDomain(finalHost))) return null
    const html = (await res.text()).slice(0, 500_000)
    return { html, finalUrl: res.url }
  } catch {
    return null
  }
}

export async function extractBrand(website: string): Promise<ExtractedBrand> {
  const empty: ExtractedBrand = {
    businessName: null, headline: null, services: [], phone: null, colors: [], logoUrl: null
  }
  const page = await fetchHomepage(website)
  if (!page) return empty
  const { html, finalUrl } = page

  const businessName =
    firstMatch(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) ??
    firstMatch(html, /<title[^>]*>([^<]+)<\/title>/i)?.split(/[|\-–]/)[0]?.trim() ??
    null

  const headline = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null

  const services: string[] = []
  for (const m of html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)) {
    const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (text && text.length <= 80) services.push(text)
    if (services.length >= 6) break
  }

  const phone = firstMatch(html, /href=["']tel:([^"']+)["']/i)

  const colors: string[] = []
  const themeColor = firstMatch(html, /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i)
  if (themeColor) colors.push(themeColor)
  for (const m of html.matchAll(/--[\w-]*(?:color|brand|primary|accent)[\w-]*\s*:\s*(#[0-9a-fA-F]{3,8})/g)) {
    if (colors.length >= 4) break
    colors.push(m[1])
  }

  const logoRaw =
    firstMatch(html, /<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)["']/i) ??
    firstMatch(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
  const logoUrl = logoRaw ? absolutize(logoRaw, finalUrl) : null

  return {
    businessName,
    headline,
    services: [...new Set(services)],
    phone,
    colors: [...new Set(colors)],
    logoUrl
  }
}

// ── Styles ───────────────────────────────────────────────────────────────────
// Vestigial. Design direction now comes from the operator's design_references
// library, which supersedes a fixed style list entirely. Kept only so old
// image-format rows still resolve a label.
export interface MockupStyle { key: string; label: string }

export const STYLES: MockupStyle[] = [
  { key: 'modern-service-v1', label: 'Modern & clean' }
]

const SYSTEM_PROMPT = `You are a senior web designer producing a homepage concept to show a
prospective client what their site could look like. You output a single, complete HTML document
and nothing else.

STRUCTURE — the page must be a full homepage, not a hero section. Include, in order:
  1. A sticky top navigation bar with the business name or logo and 4-5 anchor links
  2. A hero with a headline, one supporting sentence, and a primary call-to-action
  3. A services section built from the services provided to you
  4. An about / why-choose-us section
  5. A social-proof section — but see the HONESTY rules below
  6. A contact section with the real phone number if one was provided
  7. A footer with the business name, phone, and nav links

TECHNICAL:
  - One self-contained document: <!doctype html> through </html>, all CSS in a single <style> block
  - No external requests of any kind: no CDN links, no Google Fonts, no analytics, no <script src>.
    Use system font stacks. The only permitted external URL is the logo image URL given to you.
  - Put the extracted brand colours in :root as CSS custom properties and use them throughout
  - Responsive: must read well from 360px to 1440px wide
  - No JavaScript beyond a few lines for mobile nav toggling, if you need it
  - Use CSS gradients, shapes, and typography for visual interest instead of placeholder images.
    Never reference a stock photo URL or an image that does not exist.

HONESTY — this page is sent to a real business that will read it closely:
  - Use ONLY the services you are given. Invent none.
  - Never invent testimonials, client names, review quotes, awards, certifications, years in
    business, staff names, or statistics. If you include a social-proof section, use their real
    Google rating and review count if provided; otherwise make it a neutral value-proposition
    section with no fabricated numbers.
  - Never invent an address or an email address.

Output the raw HTML only. No markdown fences, no commentary before or after.`

function buildPrompt(
  brand: ExtractedBrand,
  prospectName: string,
  category: string | null,
  opts: { notes?: string; rating?: number | null; reviewCount?: number | null; hasScreenshot: boolean; referenceCount: number }
): string {
  const lines: string[] = ['Design a homepage concept for this business.', '']

  lines.push(`Business name: ${brand.businessName ?? prospectName}`)
  if (category) lines.push(`Type of business: ${category}`)
  if (brand.headline) lines.push(`Their current tagline, for tone reference only: "${brand.headline}"`)
  lines.push(
    brand.services.length
      ? `Services to represent (use ONLY these, invent none): ${brand.services.join(', ')}`
      : 'No services could be extracted. Keep the services section generic to the business type and do not name specific services you cannot verify.'
  )
  if (brand.phone) lines.push(`Phone number to show: ${brand.phone}`)
  if (brand.colors.length) lines.push(`Their brand colours — build the palette around these: ${brand.colors.join(', ')}`)
  else lines.push('No brand colours could be extracted. Choose a palette appropriate to the business type.')

  if (brand.logoUrl) {
    lines.push(`Their real logo — use this exact URL in an <img> in the nav and footer: ${brand.logoUrl}`)
  } else {
    lines.push('No logo is available. Set the business name in type as the wordmark instead.')
  }

  if (opts.rating != null && opts.reviewCount != null) {
    lines.push(`Their real Google rating: ${opts.rating} from ${opts.reviewCount} reviews. You may cite this figure — it is verified. Do not invent quotes to go with it.`)
  }

  if (opts.referenceCount > 0) {
    lines.push(
      '',
      `The first ${opts.referenceCount} image(s) above are design references chosen by the designer. ` +
      'Match their visual language — layout structure, typography scale, spacing, and general feel. ' +
      'Do not copy their content, and do not use their colours over the brand colours above.'
    )
  }

  if (opts.hasScreenshot) {
    lines.push(
      '',
      'The final image above is the business\'s CURRENT website. Use it to understand their brand, ' +
      'logo placement, and what they actually offer. Do not reproduce its layout — the whole point ' +
      'is to show them something better.'
    )
  }

  if (opts.notes?.trim()) {
    lines.push('', `Additional direction from the designer, which overrides the above where they conflict: ${opts.notes.trim()}`)
  }

  return lines.join('\n')
}

// The model is told to emit raw HTML, but instruction-following on "no markdown
// fences" is not perfect and a stray fence would render as literal text on the
// page the prospect opens.
function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:html)?\s*\n([\s\S]*?)\n?```$/i)
  return (fenced ? fenced[1] : trimmed).trim()
}

function mediaTypeFor(contentType: string): VisionMediaType {
  switch (contentType) {
    case 'image/jpeg': return 'image/jpeg'
    case 'image/webp': return 'image/webp'
    case 'image/gif': return 'image/gif'
    default: return 'image/png'
  }
}

// ── Persistence ──────────────────────────────────────────────────────────────

export interface ProspectMockup {
  id: string
  prospectId: string
  styleKey: string
  brand: ExtractedBrand
  prompt: string
  directionNotes: string | null
  // 'html' is current; 'image' is the legacy gpt-image-1 path, kept so preview
  // links already in prospects' inboxes keep rendering what was actually sent.
  format: 'image' | 'html'
  html: string | null
  storagePath: string | null
  currentScreenshotPath: string | null
  referenceIds: string[] | null
  model: string | null
  createdAt: string
}

interface Row {
  id: string
  prospect_id: string
  style_key: string
  brand: ExtractedBrand
  prompt: string
  direction_notes: string | null
  format: 'image' | 'html'
  html: string | null
  storage_path: string | null
  current_screenshot_path: string | null
  reference_ids: string[] | null
  model: string | null
  created_at: string
}

function fromRow(r: Row): ProspectMockup {
  return {
    id: r.id,
    prospectId: r.prospect_id,
    styleKey: r.style_key,
    brand: r.brand,
    prompt: r.prompt,
    directionNotes: r.direction_notes,
    format: r.format,
    html: r.html,
    storagePath: r.storage_path,
    currentScreenshotPath: r.current_screenshot_path,
    referenceIds: r.reference_ids,
    model: r.model,
    createdAt: r.created_at
  }
}

export async function listMockups(prospectId: string): Promise<ProspectMockup[]> {
  const { data, error } = await supabase
    .from('prospect_mockups')
    .select('*')
    .eq('prospect_id', prospectId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`Failed to list mockups: ${error.message}`)
  return ((data ?? []) as Row[]).map(fromRow)
}

export async function getMockup(id: string): Promise<ProspectMockup | null> {
  const { data, error } = await supabase.from('prospect_mockups').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`Failed to load mockup: ${error.message}`)
  return data ? fromRow(data as Row) : null
}

// ── Generation context ───────────────────────────────────────────────────────
// Everything up to, but NOT including, the Claude call — shared by the real
// generator and the free preview below, so the two can never quietly diverge.
// Building this costs a screenshot render and some Supabase reads, but zero
// LLM tokens, which is what makes previewGeneration actually free to call.

interface GenerationContext {
  brand: ExtractedBrand
  screenshot: Buffer | null
  references: DesignReference[]
  images: VisionImage[]
  prompt: string
}

async function buildGenerationContext(
  prospect: Prospect,
  opts: { directionNotes?: string }
): Promise<GenerationContext> {
  // A no-website prospect is the prime target — there's nothing to scrape, so
  // the concept is grounded in the Places data alone.
  const brand = prospect.website
    ? await extractBrand(prospect.website)
    : { businessName: prospect.name, headline: null, services: [], phone: prospect.phone, colors: [], logoUrl: null }

  // Screenshot failures are non-fatal: a prospect whose site blocks headless
  // browsers or times out should still get a concept, just without the
  // before/after.
  let screenshot: Buffer | null = null
  if (prospect.website && await screenshotsConfigured()) {
    try {
      screenshot = await captureUrl(prospect.website)
    } catch {
      screenshot = null
    }
  }

  const references = await selectReferencesForVertical(prospect.category)
  const images: VisionImage[] = []
  for (const reference of references) {
    try {
      images.push({
        buffer: await getReferenceImage(reference.storagePath),
        mediaType: mediaTypeFor(reference.contentType),
        caption: `Design reference — "${reference.label}"${reference.notes ? `. Designer's note: ${reference.notes}` : ''}`
      })
    } catch {
      // A reference whose blob has gone missing shouldn't sink the generation.
    }
  }
  if (screenshot) {
    images.push({
      buffer: screenshot,
      mediaType: 'image/png',
      caption: `The business's CURRENT website (${prospect.website}) — for brand context, not to imitate.`
    })
  }

  const prompt = buildPrompt(brand, prospect.name, prospect.category, {
    notes: opts.directionNotes,
    rating: prospect.rating,
    reviewCount: prospect.reviewCount,
    hasScreenshot: !!screenshot,
    referenceCount: images.length - (screenshot ? 1 : 0)
  })

  return { brand, screenshot, references, images, prompt }
}

// Generates a NEW row every time — "regenerate" is just calling this again, so
// a preview link that's already been shared keeps rendering the concept that
// was actually sent rather than silently changing under the prospect.
export async function generateMockup(
  prospectId: string,
  opts: { styleKey?: string; directionNotes?: string } = {}
): Promise<ProspectMockup> {
  if (!mockupsConfigured()) throw new Error('ANTHROPIC_API_KEY is not configured on this deployment')

  const prospect = await getProspect(prospectId)
  if (!prospect) throw new Error('Prospect not found')

  const ctx = await buildGenerationContext(prospect, opts)

  // The screenshot only gets persisted once a concept is actually generated —
  // previewGeneration() below builds the identical context without ever
  // writing to storage, so trying prompts for free doesn't pile up blobs.
  let currentScreenshotPath: string | null = null
  if (ctx.screenshot) {
    currentScreenshotPath = `${prospectId}/${randomUUID()}.png`
    const { error } = await supabase.storage
      .from(SCREENSHOT_BUCKET)
      .upload(currentScreenshotPath, ctx.screenshot, { contentType: 'image/png', upsert: false })
    if (error) currentScreenshotPath = null
  }

  const raw = await completeWithImages(ctx.prompt, ctx.images, { system: SYSTEM_PROMPT, maxTokens: HTML_MAX_TOKENS })
  const html = stripCodeFence(raw)
  if (!html.toLowerCase().includes('<html')) throw new Error('Concept generation did not return a complete HTML document')

  const { data, error } = await supabase
    .from('prospect_mockups')
    .insert({
      prospect_id: prospectId,
      style_key: STYLES[0].key,
      brand: ctx.brand,
      prompt: ctx.prompt,
      direction_notes: opts.directionNotes ?? null,
      format: 'html',
      html,
      current_screenshot_path: currentScreenshotPath,
      reference_ids: ctx.references.map(r => r.id),
      model: process.env.ANTHROPIC_CONTENT_MODEL ?? 'claude-sonnet-5'
    })
    .select()
    .single()
  if (error) throw new Error(`Failed to record mockup: ${error.message}`)
  return fromRow(data as Row)
}

// ── Free preview ─────────────────────────────────────────────────────────────
// Assembles exactly what generateMockup() would send to Claude — same prompt,
// same images, same system instructions — and stops there. No Anthropic call,
// so this costs zero LLM tokens. The point is to let the operator paste the
// result into a free tool (ChatGPT, Gemini) and eyeball what the current
// design-reference library + prompt actually produces before spending real
// tokens on a generation that goes into prospect_mockups.

export interface MockupPreviewImage {
  caption: string
  filename: string
  dataUrl: string
}

export interface MockupPreview {
  systemPrompt: string
  userPrompt: string
  // Merged into one paste-able block: free consumer chat UIs (ChatGPT, Gemini)
  // don't expose a separate system-role field in their basic chat box.
  combinedPrompt: string
  images: MockupPreviewImage[]
}

// A stable, readable file stem for each image so a downloaded batch sorts and
// reads sensibly in Finder/Downloads — "01-design-reference-warm-hero" beats
// a UUID when you're about to drag six files into a chat window.
function filenameFor(index: number, caption: string): string {
  const slug = caption.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return `${String(index + 1).padStart(2, '0')}-${slug || 'image'}.png`
}

export async function previewGeneration(
  prospectId: string,
  opts: { directionNotes?: string } = {}
): Promise<MockupPreview> {
  const prospect = await getProspect(prospectId)
  if (!prospect) throw new Error('Prospect not found')

  const ctx = await buildGenerationContext(prospect, opts)

  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: ctx.prompt,
    combinedPrompt: `${SYSTEM_PROMPT}\n\n---\n\n${ctx.prompt}`,
    images: ctx.images.map((img, i) => ({
      caption: img.caption,
      filename: filenameFor(i, img.caption),
      dataUrl: `data:${img.mediaType};base64,${img.buffer.toString('base64')}`
    }))
  }
}

export async function getMockupImage(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath)
  if (error) throw new Error(`Failed to load mockup image: ${error.message}`)
  return Buffer.from(await data.arrayBuffer())
}

export async function getScreenshotImage(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(SCREENSHOT_BUCKET).download(storagePath)
  if (error) throw new Error(`Failed to load screenshot: ${error.message}`)
  return Buffer.from(await data.arrayBuffer())
}
