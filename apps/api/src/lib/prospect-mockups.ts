import { randomUUID } from 'crypto'
import { isPublicHost, normalizeDomain } from '@agent-platform/shared'
import { supabase } from './supabase'
import { getProspect, type Prospect } from './prospecting'
import { completeWithImages, type VisionImage, type VisionMediaType, type UsageSink } from './llm/complete'
import { generateMockupImage, imageGenConfigured, type GeneratedImage } from './llm/image-gen'
import { claudeCostMicros } from './llm/pricing'
import { selectReferencesForLibrary, getReferenceImage, type DesignReference } from './design-references'
import { captureBrandSnapshot, screenshotsConfigured, auditConceptLayout, type BrandSnapshot, type LayoutFinding } from './screenshots'
import type { CostItem } from './prospect-generation-runs'

// What generateMockup reports progress and spend to. Structural, and declared
// here rather than imported as the concrete RunTracker, so the generation code
// has no dependency on the run-tracking table — passing nothing is a valid,
// fully-supported way to call it (the advanced per-step buttons still do).
export interface GenerationProgress {
  begin(key: string, typicalMs: number, detail?: string): Promise<void>
  finish(key: string, detail?: string): Promise<void>
  skip(key: string, detail: string): Promise<void>
  addCost(item: CostItem): Promise<void>
}

// Prospecting — a generated "here's what your homepage could look like"
// concept, sent to a prospect as a real, scrollable page.
//
// This used to generate an IMAGE (gpt-image-1, 1536x1024). That capped quality
// no matter how the prompt was tuned: a landscape canvas cannot hold a whole
// page, image models garble nav bars and body text, and a flat PNG can't carry
// the prospect's actual logo or be hand-tweaked. Concepts are now HTML
// documents written by a vision model.
//
// Generated images did NOT go away, though — they moved upstream. The
// layout-first flow (buildLayoutFirstContext) draws a full-page design for the
// business and feeds it to the HTML pass as the layout spec, which plays to
// what image models are good at (composition) and around what they are bad at
// (text), since every word still comes from the scraped brand.
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
//
// Raised from 16000 after a real truncation: a concept came back cut off
// mid-<svg> having spent exactly 16000 output tokens. Finished pages land
// around 28KB of HTML, but inline SVG icon paths tokenize badly (long runs of
// digits and decimals), so a page with a few extra icons can cross a limit
// that the same page without them clears. This is a ceiling, not a target —
// the run is billed on tokens actually produced, so headroom is free.
const HTML_MAX_TOKENS = 32000

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
  // Real photo URLs found on their current site — hero/service/crew shots —
  // so the concept can reuse actual imagery instead of only CSS gradients.
  // Empty for no-website prospects or if the DOM pass found nothing usable.
  photoUrls: string[]
  // A real license/registration number found on the page (e.g. "License
  // #CCC1331776"). Regex, not the vision model reading it off a screenshot —
  // license numbers are exactly the kind of detail a vision model can
  // transpose a digit on, and this one is worth getting right.
  license: string | null
  // Real trust signals found verbatim on the page — "BBB Accredited",
  // "Licensed & Insured", named manufacturer-certification programs — matched
  // against a fixed phrase list (see CERTIFICATION_PHRASES) rather than free
  // text, so nothing here is ever a paraphrase or a guess.
  certifications: string[]
  // Real partner/material-supplier logo URLs (e.g. a "products we use"
  // strip) — same real-asset provenance as photoUrls. Empty for no-website
  // prospects or if the DOM pass found nothing usable; the regex pass can't
  // reliably tell a logo strip from a photo gallery.
  partnerLogoUrls: string[]
}

// Verbatim phrases only — matched, not paraphrased, so a "certification" the
// concept displays is always something the business's own page actually
// says, never the model's inference from vague nearby marketing copy.
const CERTIFICATION_PHRASES = [
  'BBB Accredited', 'Better Business Bureau', 'Licensed & Insured', 'Licensed and Insured',
  'Bonded & Insured', 'Bonded and Insured', 'GAF Certified', 'GAF Master Elite',
  'Owens Corning Preferred Contractor', 'Owens Corning Platinum', 'CertainTeed',
  'Angi Certified', "Angie's List", 'HomeAdvisor Screened', 'NRCA Member',
]

function extractCertifications(html: string): string[] {
  const text = html.replace(/<[^>]+>/g, ' ')
  const found: string[] = []
  for (const phrase of CERTIFICATION_PHRASES) {
    if (new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text)) found.push(phrase)
  }
  return found
}

// Florida contractor licenses (this pipeline's only market so far) read like
// "License #CCC1331776" — a 2-4 letter prefix plus digits — but the pattern
// is kept general enough to also catch a plain "License #123456" elsewhere.
function extractLicense(html: string): string | null {
  const text = html.replace(/<[^>]+>/g, ' ')
  return firstMatch(text, /\bLic(?:ense)?\.?\s*(?:no\.?|#)?\s*:?\s*([A-Z]{0,4}\d{4,10})\b/i)
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
    businessName: null, headline: null, services: [], phone: null, colors: [], logoUrl: null, photoUrls: [],
    license: null, certifications: [], partnerLogoUrls: []
  }
  const page = await fetchHomepage(website)
  if (!page) return empty
  const { html, finalUrl } = page

  const businessName =
    firstMatch(html, /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) ??
    firstMatch(html, /<title[^>]*>([^<]+)<\/title>/i)?.split(/[|\-–]/)[0]?.trim() ??
    null

  const headline = firstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null

  // Any <h2>/<h3> is a crude proxy for "service" — without knowing the page's
  // actual structure it can just as easily be the business name repeated in a
  // section heading, or a marketing sentence ("We're proud to..."), neither of
  // which is a real service. Drop anything that reads like a sentence (ends in
  // punctuation, or opens with first-person marketing language) or duplicates
  // the headline/business name — a coarse filter, not a real fix; the
  // vision-based design analysis (below) is what actually verifies services
  // against the page's real content.
  const MARKETING_OPENER = /^(we're|we are|our (team|mission|company|goal)|proud to|committed to|welcome to|dedicated to)\b/i
  const services: string[] = []
  for (const m of html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)) {
    const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (!text || text.length > 60) continue
    if (/[.!?]$/.test(text)) continue
    if (MARKETING_OPENER.test(text)) continue
    if (businessName && text.toLowerCase() === businessName.toLowerCase()) continue
    if (headline && text.toLowerCase() === headline.toLowerCase()) continue
    services.push(text)
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
    logoUrl,
    photoUrls: [],       // regex pass can't reliably size/filter <img> tags; DOM pass below fills this in
    license: extractLicense(html),
    certifications: extractCertifications(html),
    partnerLogoUrls: []  // same reason as photoUrls above
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

THE DESIGN REFERENCES ARE THE SPEC. Images labelled as design references are not mood-board
decoration — they are the layout you are being asked to reproduce for a different business. Before
writing any code, study them and identify: how the hero is composed, which sections are full-bleed
vs contained, where the grid breaks asymmetry, how large the type-size jump is between headline and
body, how images are cropped and framed, and how dense the spacing is. Then build THAT, using this
business's content and colours. If your output could be swapped onto any other service business
without anyone noticing, you have failed this instruction.

Sometimes the first image will instead be a generated full-page mockup of THIS business's homepage.
When it is, the prompt below says so explicitly, and that mockup becomes the spec — the other
references drop to supporting detail for anything it renders too small to read. Its layout is
authoritative; its text never is, because an image model drew it. Copy is always the text you are
given, never words read off an image.

REQUIRED CONTENT — every one of these must appear somewhere, but the references above decide their
order, arrangement, proportions, and treatment. This is a content checklist, NOT a layout template,
and it is deliberately unordered: do not default to stacking them top-to-bottom as listed.
  - Navigation with the business name or logo and 4-5 anchor links. The links sit CENTRED in the
    header — see NAV CENTRING under TECHNICAL for the layout that actually holds them there.
  - A hero: headline, supporting sentence, primary call-to-action
  - The services provided to you
  - An about / why-choose-us treatment
  - Social proof — but see the HONESTY rules below. If a real Google rating is provided, mark it as
    coming from Google using the GOOGLE ICON block given below — a bare star rating with no source
    reads as generic and unverifiable, the same way an unbadged testimonial does.
  - Contact, with the real phone number if one was provided
  - A footer with the business name, phone, and nav links. It's the last thing on the page and gets
    treated as an afterthought unless you're deliberate: give it a real dark/neutral background from
    your token set (not plain white or a bare border-top), organise its content into clear columns
    using the same spacing/type tokens as the rest of the page, and use the logo here too if one was
    given. It should read as a considered close to the page, not a leftover strip of text.

LAYOUT — most concepts fail by being timid, not by being wrong. A page where every section is the
same width, the same height, and the same rhythm reads as a template no matter how good the colours
are. Unless the references clearly do otherwise:
  - Vary section width: let at least one section go full-bleed edge-to-edge against contained ones
  - Vary the grid: asymmetric splits (60/40, 70/30) rather than everything 50/50 or 3-up equal cards
  - Push type contrast hard: the hero headline should be dramatically larger than body copy, not one
    step up the scale. Modern editorial design lives on that jump.
  - Use depth where the references do: offset/overlapping elements, a badge or stat card breaking out
    over an image edge, image bleeding past its container
  - Vary vertical rhythm: not every section deserves identical padding
  - If you use oversized background typography as a decorative flourish (a giant faint wordmark
    behind a section), it must never sit directly behind the actual headline text at overlapping
    size/position — that produces two competing text layers and the headline stops being legible.
    Keep it low-opacity, offset, and clearly behind rather than through the readable text.

TECHNICAL:
  - One self-contained document: <!doctype html> through </html>, all CSS in a single <style> block
  - No external requests of any kind: no CDN links, no Google Fonts, no analytics, no <script src>,
    no icon font/library. Use system font stacks. The only permitted external URLs are the logo image
    URL and any real photo URLs explicitly given to you below — never any other image URL, and never
    a stock-photo or placeholder URL that wasn't given to you.
  - Responsive: must read well from 360px to 1440px wide
  - No JavaScript beyond a few lines for mobile nav toggling, if you need it
  - Icons: draw simple inline SVG icons directly in the HTML (viewBox="0 0 24 24", one consistent
    stroke-width/style throughout — pick line icons or filled icons based on what the design
    references use, not both). Use them for services/features rather than emoji or an icon font.
  - NAV CENTRING — a header of logo / links / CTA must NOT use flex with justify-content:
    space-between. That only centres the middle group when the two outer items happen to be the
    same width, and they never are (a 49px logo against a 214px CTA button pushes the links 83px
    left — half the difference — which reads as "slightly off" without looking obviously broken).
    Use a three-column grid so the middle column is centred against the header itself:
      .nav { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; }
      .nav > .nav-logo  { justify-self: start; }
      .nav > .nav-links { justify-self: center; }
      .nav > .nav-cta   { justify-self: end; }
    One caveat this layout does not solve on its own: once logo + links + CTA no longer fit with
    room to spare, the CTA pins the third column at its intrinsic width while the first column
    collapses, and the grid quietly stops being symmetric again. So switch to the mobile/hamburger
    header while there is still slack — around 900px for a typical nav, NOT 640px — rather than
    letting a squeezed desktop nav drift:
      @media (max-width: 900px) { .nav { display: flex; justify-content: space-between; }
                                  .nav-links { display: none; } .nav-toggle { display: block; } }
  - RESET MARGINS, not just box-sizing. A bare "* { box-sizing: border-box }" is NOT enough: it
    leaves every h1-h6, p, ul and figure carrying the browser's default margins (an h4 keeps a
    1.33em top margin ≈ 22px), which silently pushes text out of alignment with anything sitting
    beside it. Start the stylesheet with:
      *, *::before, *::after { box-sizing: border-box; }
      body, h1, h2, h3, h4, h5, h6, p, ul, ol, figure, blockquote { margin: 0; padding: 0; }
    Then set every margin you actually want explicitly, from the spacing scale.
  - ICON + TEXT ALIGNMENT — a fixed-size icon (or icon in a circular/rounded badge) beside a heading
    with body copy under it is one of the most common ways a generated page looks subtly "off":
    invisible in the markup, obvious on screen. Two failure modes to avoid:
      * align-items: center on the row centres the icon against the heading AND the paragraph
        combined, so it drifts further the longer the body copy runs.
      * align-items: flex-start aligns the two boxes' TOP EDGES, which only aligns their centres if
        the boxes are the same height — an icon badge is typically ~40px while a heading's line box
        is ~25px, leaving the title looking ~7px low even with margins correctly reset.
      Centre the icon on the heading's FIRST LINE — not on the heading's box, which grows when the
      text wraps at narrow widths and drags the icon down with it. Pin the badge to line one by
      offsetting it half the difference between the line height and the badge height:
        .item { --badge: 40px; --title-line: 25px;
                display: flex; gap: var(--space-3); align-items: flex-start; }
        .item-icon { width: var(--badge); height: var(--badge); flex-shrink: 0;
                     display: flex; align-items: center; justify-content: center;
                     margin-top: calc((var(--title-line) - var(--badge)) / 2); }
        .item h4  { line-height: var(--title-line); margin: 0 0 var(--space-1); }
      Both centres then sit at exactly the same offset from the row's top edge, and stay there
      however many lines the heading runs to. Do NOT instead give the heading a min-height equal to
      the badge and centre its text — that looks identical on one line but drifts as soon as the
      heading wraps. Apply this to every icon+text row on the page (feature lists, why-choose-us
      items, contact details), not just one section.
  - GOOGLE ICON — for the Google rating badge only, never freehand a Google logo from description;
    you will render it wrong. Copy this exact markup verbatim, character for character, changing
    nothing but the width/height attributes if you need a different size — this is Google's own
    multicolour mark (sourced from Google's own hosted asset, gstatic.com), not an approximation:
    <svg viewBox="0 0 118 120" width="20" height="20" xmlns="http://www.w3.org/2000/svg">
    <path fill="#4285F4" d="M117.6,61.3636364 C117.6,57.1090909 117.218182,53.0181818
    116.509091,49.0909091 L60,49.0909091 L60,72.3 L92.2909091,72.3 C90.9,79.8 86.6727273,86.1545455
    80.3181818,90.4090909 L80.3181818,105.463636 L99.7090909,105.463636 C111.054545,95.0181818
    117.6,79.6363636 117.6,61.3636364 L117.6,61.3636364 Z"/>
    <path fill="#34A853" d="M60,120 C76.2,120 89.7818182,114.627273 99.7090909,105.463636
    L80.3181818,90.4090909 C74.9454545,94.0090909 68.0727273,96.1363636 60,96.1363636
    C44.3727273,96.1363636 31.1454545,85.5818182 26.4272727,71.4 L6.38181818,71.4
    L6.38181818,86.9454545 C16.2545455,106.554545 36.5454545,120 60,120 L60,120 Z"/>
    <path fill="#FBBC05" d="M26.4272727,71.4 C25.2272727,67.8 24.5454545,63.9545455
    24.5454545,60 C24.5454545,56.0454545 25.2272727,52.2 26.4272727,48.6 L26.4272727,33.0545455
    L6.38181818,33.0545455 C2.31818182,41.1545455 0,50.3181818 0,60 C0,69.6818182
    2.31818182,78.8454545 6.38181818,86.9454545 L26.4272727,71.4 L26.4272727,71.4 Z"/>
    <path fill="#EA4335" d="M60,23.8636364 C68.8090909,23.8636364 76.7181818,26.8909091
    82.9363636,32.8363636 L100.145455,15.6272727 C89.7545455,5.94545455 76.1727273,0 60,0
    C36.5454545,0 16.2545455,13.4454545 6.38181818,33.0545455 L26.4272727,48.6
    C31.1454545,34.4181818 44.3727273,23.8636364 60,23.8636364 L60,23.8636364 Z"/></svg>
    Put it on a small neutral/white circular backing (a coloured mark needs a light background to
    read correctly) rather than tinting it — it has no fill you can safely override.
  - Where CSS visual interest is still needed (no photo available for a given spot), use gradients,
    shapes, and typography — never a stock photo URL or an image that doesn't exist.
  - Photos: you don't know their aspect ratios, so always constrain them with a fixed container plus
    object-fit: cover (never object-fit: fill, never raw width+height that would stretch them). Some
    scraped photos may already have text burned into them — if a photo looks like it carries its own
    caption or wordmark, use it somewhere incidental rather than as the hero, and never lay your own
    headline text on top of it.

DESIGN SYSTEM — this is what makes a concept look considered rather than
improvised. Define a small token set in :root and use ONLY these tokens for
spacing/sizing/color throughout — no ad hoc pixel values or one-off colors
outside it:
  - The extracted brand colours (primary/accent/neutral roles as appropriate)
  - A spacing scale on a consistent ratio, e.g. --space-1 through --space-8
  - A type scale, e.g. --text-sm through --text-4xl, plus one line-height
  - One --radius and one --shadow value, reused everywhere something needs
    rounding or elevation rather than improvised per-component
  - Contrast: body text on its background must stay comfortably readable
    (roughly WCAG AA, ~4.5:1). If the extracted brand colours don't give
    enough contrast for text use, adjust their lightness for that use — don't
    discard the brand colour or fall back to plain black/white.

VISUAL BOLDNESS — the brand colours you're given are a hue constraint, not a
lightness/contrast constraint. If the extracted colours are pale or muted but
the design references shown to you are bold, dark, or high-contrast, derive
bold/dark shades FROM the brand hue (deep tints, near-black derived from the
brand colour rather than plain #000, saturated accent variants for CTAs) —
match the references' contrast level and boldness, not just their layout.
A concept that ends up looking washed-out or generic because it took the
brand palette too literally has failed at this, even if every other rule was
followed.

HONESTY — this page is sent to a real business that will read it closely:
  - Use ONLY the services you are given. Invent none.
  - Never invent testimonials, client names, review quotes, awards, certifications, years in
    business, staff names, or statistics. If you include a social-proof section, use their real
    Google rating and review count if provided; otherwise make it a neutral value-proposition
    section with no fabricated numbers.
  - Certifications/trust badges (BBB, licensed & insured, manufacturer programs) appear below ONLY
    when the business's own page actually states them — if given, show that exact phrase as plain
    text (a checkmark line, a small text badge), never as a fabricated logo image, and never add
    ones not given even if they'd be plausible for this trade.
  - A license number, if given, is a real detail transcribed off their page — reproduce it exactly,
    digit for digit. Do not use it if not given, and do not attempt to reconstruct or guess one.
  - Never invent an address or an email address.
  - Only use photo URLs explicitly given to you — including any partner/supplier logo URLs, which
    are for a small trust strip only, never the hero or a service photo. Never invent, guess, or
    hotlink any other image URL. The one exception is the literal AI-photo placeholder tokens
    described below, if given — those are not URLs and must be copied exactly, not treated as a
    licence to invent or hotlink an actual image address.

Output the raw HTML only. No markdown fences, no commentary before or after.`

function buildPrompt(
  brand: ExtractedBrand,
  prospectName: string,
  category: string | null,
  opts: PromptOpts
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

  if (opts.aiPhotoPlaceholders?.length) {
    lines.push(
      `Stock-style photography for this page — NOT real URLs, literal placeholder tokens: ` +
      `${opts.aiPhotoPlaceholders.join(', ')}. Use each one EXACTLY as given, character for character, as ` +
      `the entire src of an <img> tag or the entire argument of a CSS url() — e.g. <img src="${opts.aiPhotoPlaceholders[0]}"> ` +
      `or background:url('${opts.aiPhotoPlaceholders[0]}') center/cover no-repeat. Do not append a file extension, a ` +
      `path, or anything else to the token; do not treat it as needing a protocol or domain. It will be ` +
      `replaced with the real image after you respond, so an exact, unmodified copy is required for that ` +
      `to work. Use them for the hero and any other large photo slots (service imagery, about section), ` +
      `reusing one across multiple slots if you have fewer tokens than slots. Because these are generic ` +
      `stock photography, not real photos of this specific business, never caption them with a claim of ` +
      `authenticity — no "our team", no "our work", no named staff. Frame any caption around the ` +
      `service/value shown, not who's pictured.`
    )
  } else if (brand.photoUrls.length) {
    lines.push(
      `Real photos from their current site, safe to reuse as actual <img> elements (hero image, service ` +
      `cards, etc — use several of these rather than relying only on CSS gradients/shapes): ${brand.photoUrls.join(', ')}`
    )
  }

  if (brand.partnerLogoUrls.length) {
    lines.push(
      `Real partner/material-supplier logos from their current site (e.g. "products we use") — safe to ` +
      `reuse in a small trust strip near the footer or the why-choose-us section, NOT as a hero or ` +
      `service photo. You don't know their aspect ratios or background colour, so give each one a fixed ` +
      `container, object-fit: contain, and a neutral/white background so mismatched logo colours don't ` +
      `clash: ${brand.partnerLogoUrls.join(', ')}`
    )
  }

  if (opts.rating != null && opts.reviewCount != null) {
    lines.push(
      `Their real Google rating: ${opts.rating} from ${opts.reviewCount} reviews. You may cite this ` +
      `figure — it is verified. Do not invent quotes to go with it. Mark it as a Google rating using ` +
      `the GOOGLE ICON block from the system instructions, not a bare star rating with no source.`
    )
  }

  if (brand.license) {
    lines.push(`Their real license number, from their own page — show it verbatim in the footer: ${brand.license}`)
  }

  if (brand.certifications.length) {
    lines.push(
      `Real trust badges/certifications their page actually states — show these exact phrases as plain ` +
      `text near contact or why-choose-us, never as a fabricated logo image, and add no others: ` +
      `${brand.certifications.join(', ')}`
    )
  }

  if (opts.styleNotes?.trim()) {
    lines.push(
      '',
      `Design analysis of the reference images and their current site (treat this as authoritative art ` +
      `direction for this concept): ${opts.styleNotes.trim()}`
    )
  }

  // Image order matches assembleGenerationAssets' images array: the generated
  // layout draft (layout-first flow only), then the design references, then
  // the logo crop, then the current-site screenshot last.
  const offset = opts.hasGeneratedLayout ? 1 : 0

  if (opts.hasGeneratedLayout) {
    lines.push(
      '',
      'IMAGE 1 above is a full-page design mockup of THIS business\'s new homepage, generated from ' +
      'the same brand details and references you have. It is the layout spec — build that page. ' +
      'Reproduce its section order, relative section heights, full-bleed vs contained rhythm, colour ' +
      'blocking, and where imagery sits against text, so your page is recognisably that design built ' +
      'properly in code rather than a different take on the same brief.',
      '',
      'What you must NOT take from it is its TEXT. An image model drew it, so its wording is garbled ' +
      'and any numbers in it are invented — treat every string in that image as a placeholder ' +
      'indicating "some text goes here", never as copy to transcribe. The business name, services, ' +
      'phone number, rating, review count, and colour values all come from the text above. Where the ' +
      'mockup shows a block of text, write the real copy that belongs in that slot. The same goes ' +
      'for its logo: use the real logo URL above, not a redraw of what the mockup rendered.'
    )
  }

  if (opts.referenceCount > 0 && opts.hasGeneratedLayout) {
    lines.push(
      '',
      `Images ${offset + 1}–${offset + opts.referenceCount} above are the design references the mockup ` +
      'was built from. Use them to resolve detail the mockup renders too small or too roughly to read ' +
      '— button and icon treatment, type personality, spacing feel, image framing. Where they and the ' +
      'mockup disagree about layout, the mockup wins: it is the one made for this business.'
    )
  } else if (opts.referenceCount > 0) {
    lines.push(
      '',
      (opts.hasPrimaryReference
        ? 'The FIRST image above is the PRIMARY reference: follow its layout and composition closely — ' +
          'section arrangement, proportions, and framing should be recognisably the same page applied to ' +
          'this business. The remaining reference images are secondary style influence only (button ' +
          'treatment, icon style, spacing feel), not layouts to blend in. '
        : '') +
      `The first ${opts.referenceCount} image(s) above are the design references — the layout spec ` +
      'for this page, per the system instructions. Reproduce their composition: section arrangement, ' +
      'full-bleed vs contained rhythm, grid asymmetry, type-scale jump, image framing, spacing ' +
      'density. Borrow their contrast level and boldness too. What you must NOT take from them is ' +
      'their content (copy, business names, services) or their exact hues — those come from the ' +
      'brand colours above, which you may darken or saturate to reach the references\' contrast level.'
    )
  }

  if (opts.hasLogoCrop) {
    lines.push(
      '',
      `Image ${offset + opts.referenceCount + 1} above is their actual logo, cropped for clarity from ` +
      'their live site. Reproduce its wordmark treatment and colours in the nav — do not redraw or ' +
      'reinterpret it.'
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

// ── Image concept (real generated PNG, alt to the HTML path above) ─────────────
// images.edit() takes ONE text prompt and an array of reference images with no
// per-image captions or a separate system slot (unlike completeWithImages'
// Claude messages, which interleave a caption before each image) — so image
// role framing has to live inside the single prompt string itself, referring
// to images by position, same as buildPrompt() already does for its "image N
// above" callouts. Keeps the same HONESTY/LAYOUT/VISUAL BOLDNESS art direction
// as the HTML prompt (those are about what the design should look like, not
// how it's coded) and drops the HTML/CSS-specific TECHNICAL section entirely.
function buildImagePrompt(
  brand: ExtractedBrand,
  prospectName: string,
  category: string | null,
  opts: PromptOpts
): string {
  const lines: string[] = [
    'Generate a single polished homepage design mockup image for this business — a realistic, ' +
    'high-fidelity visual of what their website homepage could look like, as if it were a real ' +
    'screenshot of a finished, professionally designed site. Not an illustration or a collage.',
    '',
    'FRAME THE WHOLE PAGE. This is a full-page capture — the entire homepage from the top of the ' +
    'nav bar down to the bottom of the footer, composed as one tall vertical image, the way a ' +
    'full-page screenshot tool captures a page by scrolling it. It is NOT a browser-viewport crop: ' +
    'do not stop after the hero. Every one of these must be present and visibly distinct, stacked ' +
    'down the page: nav bar, hero, services, an about / why-choose-us treatment, a social-proof or ' +
    'value-proposition section, contact, and a dark footer. Sections lower down will render small — ' +
    'that is expected and correct, so shrink them rather than dropping them. Do not draw browser ' +
    'chrome, an address bar, a device frame, or a drop shadow around the page: output the page ' +
    'itself, filling the image edge to edge.',
    ''
  ]

  lines.push(`Business name: ${brand.businessName ?? prospectName}`)
  if (category) lines.push(`Type of business: ${category}`)
  lines.push(
    brand.services.length
      ? `Services to represent as real text in the design (use ONLY these, invent none): ${brand.services.join(', ')}`
      : 'No services could be extracted — keep any service text generic to the business type, nothing you cannot verify.'
  )
  if (brand.colors.length) lines.push(`Their brand colours — build the palette around these: ${brand.colors.join(', ')}`)
  else lines.push('No brand colours could be extracted. Choose a palette appropriate to the business type.')
  if (opts.rating != null && opts.reviewCount != null) {
    lines.push(`Their real Google rating: ${opts.rating} from ${opts.reviewCount} reviews — may appear as a small real stat, do not invent quotes to go with it.`)
  }

  if (opts.styleNotes?.trim()) {
    lines.push('', `Design analysis to treat as authoritative art direction: ${opts.styleNotes.trim()}`)
  }

  if (opts.referenceCount > 0) {
    lines.push(
      '',
      (opts.hasPrimaryReference
        ? 'The FIRST reference image is the PRIMARY layout to follow closely — recognisably the same ' +
          'composition applied to this business. The remaining reference images are secondary style ' +
          'influence only (colour boldness, spacing feel), not layouts to blend in. '
        : '') +
      `The first ${opts.referenceCount} image(s) given to you are design references — reproduce their ` +
      'composition (full-bleed vs contained sections, grid asymmetry, headline-to-body type-scale ' +
      'jump, spacing density) and their contrast/boldness level. Do not copy their text content or ' +
      'their exact hues — use the brand colours above, darkened or saturated to match the references\' ' +
      'contrast level.'
    )
  }

  if (opts.hasLogoCrop) {
    lines.push(
      '',
      `Image ${opts.referenceCount + 1} given to you is their actual logo, cropped from their live site — ` +
      'render it faithfully in the nav area, matching its real wordmark and colours. Do not redraw or reinterpret it.'
    )
  }

  if (opts.hasScreenshot) {
    lines.push(
      '',
      'The final image given to you is a screenshot of their CURRENT website — for brand/content context ' +
      'only. Do not reproduce its layout; the point is to show them something visibly better.'
    )
  }

  lines.push(
    '',
    'Do not invent testimonials, review quotes, staff names, awards, or statistics anywhere in the ' +
    'image. Push visual boldness: vary section proportions rather than making everything equal-width ' +
    'and equal-height, and make the headline dramatically larger than any body text.'
  )

  if (opts.forLayoutReference) {
    lines.push(
      '',
      'This image is a working layout draft that a designer will rebuild properly in code. Nobody ' +
      'will see it as-is, so spend everything on composition and nothing on polish: section order, ' +
      'relative heights, where imagery sits versus text, which bands are full-bleed, and how the ' +
      'colour blocking runs down the page. Small body text can read as realistic type texture rather ' +
      'than perfectly formed words — but keep the nav, the hero headline, and each section heading ' +
      'large and clear enough to tell what that section is.'
    )
  }

  if (opts.notes?.trim()) {
    lines.push('', `Additional direction, which overrides the above where they conflict: ${opts.notes.trim()}`)
  }

  return lines.join('\n')
}

// ── AI stock photography (opt-in alternative to the business's own scraped
// photos) ────────────────────────────────────────────────────────────────────
// A scraped photo can be missing, tiny, oddly cropped, or — as the Tampa Roof
// Repair concept found the hard way — carry its own burned-in caption that
// collides with whatever headline gets placed over it. The operator can opt
// into generating clean stock-style photography instead: no real photo of
// THIS business, but no text/logo/caption baked in either, and full control
// over composition. This is a per-generation content choice the operator
// makes deliberately (aiPhotos on generateMockup), not an automatic fallback
// — using a business's own real imagery is still the default and the more
// honest choice when it's usable.
//
// Two roles only, not one per section: a wide hero shot and a detail/close-up
// shot, reusable across whatever photo slots the HTML actually has. More
// roles would mean more image-gen calls stacked on top of the HTML call
// (and layoutFirst's call, if that's also on) for a benefit Claude can
// already get by reusing two good photos — this mirrors buildLayoutFirstContext's
// same "keep the extra image-gen calls to what's actually needed" posture.
interface StockPhotoRole { role: 'hero' | 'detail'; description: string }

function stockPhotoRoles(category: string | null): StockPhotoRole[] {
  const trade = category?.trim() || 'service business'
  return [
    {
      role: 'hero',
      description: `A wide, professional photograph of ${trade} work in progress — a tradesperson actively ` +
        `working, shot like a real editorial or marketing photo: natural lighting, shallow depth of field, ` +
        `candid rather than posed, believable equipment and setting for this trade.`
    },
    {
      role: 'detail',
      description: `A close-up detail photograph relevant to ${trade} — tools, materials, or hands-on work, ` +
        `shot with the same natural, editorial photographic style as the hero image.`
    }
  ]
}

function buildStockPhotoPrompt(role: StockPhotoRole, brand: ExtractedBrand): string {
  const lines = [
    role.description,
    '',
    'This must be a clean, purely photographic image: absolutely NO text, letters, numbers, logos, ' +
    'watermarks, captions, or signage of any kind anywhere in the frame — not the business\'s name, not ' +
    'a generic sign, nothing. It will be dropped directly behind or beside real headline text on a ' +
    'webpage, so any text baked into the photo itself will collide with that. Photorealistic, not an ' +
    'illustration, not a 3D render — a convincing photograph.',
  ]
  if (brand.colors.length) {
    lines.push(
      '',
      `Where it reads naturally (uniform accents, equipment, background tones), a hint of this brand's ` +
      `colour palette is welcome but not forced: ${brand.colors.join(', ')}. Do not tint the whole photo ` +
      `unnaturally to match — it should still read as a real, unedited photograph.`
    )
  }
  return lines.join('\n')
}

export interface StockPhoto {
  role: StockPhotoRole['role']
  image: GeneratedImage
}

// Runs the two role prompts in parallel — independent generations, no reason
// to serialize them and double the wait.
export async function generateStockPhotos(brand: ExtractedBrand, category: string | null): Promise<StockPhoto[]> {
  const roles = stockPhotoRoles(category)
  return Promise.all(
    roles.map(async role => ({
      role: role.role,
      image: await generateMockupImage(buildStockPhotoPrompt(role, brand), [], { shape: 'photo', tier: 'final' })
    }))
  )
}

// Short, easily-copyable, unambiguous — not URL-shaped, so nothing mistakes
// it for a real address if Claude drops one into a strayed context.
function stockPhotoPlaceholder(index: number): string {
  return `AI_STOCK_PHOTO_${index}`
}

// Deterministic post-processing, run AFTER Claude returns HTML: swaps each
// placeholder token for the real base64 data URI. This has to happen outside
// the model entirely — a single generated photo's base64 easily exceeds
// HTML_MAX_TOKENS on its own, so Claude was only ever given a short token to
// copy, never the image data itself. Plain substring replacement (not regex),
// deliberately: the tokens are unique, alnum-only strings, so there is no
// escaping/anchoring to get right, and a missed occurrence just means that
// photo wasn't used — never a broken replace.
function embedStockPhotos(html: string, photos: StockPhoto[]): string {
  let out = html
  photos.forEach((photo, i) => {
    const token = stockPhotoPlaceholder(i + 1)
    const dataUri = `data:${photo.image.mediaType};base64,${photo.image.buffer.toString('base64')}`
    out = out.split(token).join(dataUri)
  })
  return out
}

// The model is told to emit raw HTML, but instruction-following on "no markdown
// fences" is not perfect and a stray fence would render as literal text on the
// page the prospect opens.
function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:html)?\s*\n([\s\S]*?)\n?```$/i)
  return (fenced ? fenced[1] : trimmed).trim()
}

// Generated images are JPEG on Gemini and PNG on OpenAI, so the stored file's
// extension has to follow the bytes — the routes that serve these back derive
// the Content-Type from it rather than assuming PNG.
function extFor(mediaType: VisionMediaType): string {
  return mediaType === 'image/jpeg' ? 'jpg' : mediaType === 'image/webp' ? 'webp' : mediaType === 'image/gif' ? 'gif' : 'png'
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
  // The layout-first draft image this concept was built from, if any — an
  // internal reference, never served to the prospect. See buildLayoutFirstContext.
  layoutImagePath: string | null
  currentScreenshotPath: string | null
  referenceIds: string[] | null
  libraryId: string | null
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
  layout_image_path: string | null
  current_screenshot_path: string | null
  reference_ids: string[] | null
  library_id: string | null
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
    layoutImagePath: r.layout_image_path,
    currentScreenshotPath: r.current_screenshot_path,
    referenceIds: r.reference_ids,
    libraryId: r.library_id,
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

// Deletes a concept and the blobs it owns.
//
// Refuses while a live preview link points at it, and that refusal is the
// whole reason this isn't a plain row delete: prospect_previews.mockup_id is
// ON DELETE SET NULL, so removing the row does NOT break the link — it leaves
// it resolving to a page with no concept on it. A prospect who opens the URL
// already sitting in their inbox would see an empty pitch, and nothing in the
// dashboard would indicate anything was wrong. Revoking the link first is a
// deliberate, visible act; silently gutting a live page is not.
export async function deleteMockup(id: string): Promise<void> {
  const mockup = await getMockup(id)
  if (!mockup) throw new Error('Concept not found')

  const { data: previews, error: previewError } = await supabase
    .from('prospect_previews')
    .select('id, revoked_at')
    .eq('mockup_id', id)
  if (previewError) throw new Error(`Failed to check preview links: ${previewError.message}`)
  if ((previews ?? []).some(p => !p.revoked_at)) {
    throw new Error('This concept has a live preview link. Revoke the link first, otherwise anyone who already has the URL would land on an empty page.')
  }

  // Storage first: a deleted row with orphaned blobs is unrecoverable waste,
  // whereas a failed row delete after a successful blob delete leaves a
  // visibly broken concept the operator can delete again. Best-effort per
  // path — a missing blob must not block removing the row.
  const removals: Array<Promise<unknown>> = []
  const bucketPaths = [mockup.storagePath, mockup.layoutImagePath].filter((p): p is string => !!p)
  if (bucketPaths.length) removals.push(supabase.storage.from(BUCKET).remove(bucketPaths))
  if (mockup.currentScreenshotPath) {
    removals.push(supabase.storage.from(SCREENSHOT_BUCKET).remove([mockup.currentScreenshotPath]))
  }
  await Promise.allSettled(removals)

  const { error } = await supabase.from('prospect_mockups').delete().eq('id', id)
  if (error) throw new Error(`Failed to delete concept: ${error.message}`)
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

// Merges Playwright's computed-style/logo-detection pass over the regex pass:
// colors/logoUrl come from the live DOM when available (catches Tailwind,
// external stylesheets, inline styles — anything the raw-text regex above
// can't see), falling back to the regex-derived values only if the browser
// pass failed outright (site blocks headless browsers, times out, etc).
async function captureBrand(
  website: string, regexBrand: ExtractedBrand
): Promise<{ brand: ExtractedBrand; screenshot: Buffer | null; logoCrop: Buffer | null }> {
  if (!await screenshotsConfigured()) return { brand: regexBrand, screenshot: null, logoCrop: null }
  try {
    const snapshot: BrandSnapshot = await captureBrandSnapshot(website)
    return {
      brand: {
        ...regexBrand,
        colors: snapshot.colors.length ? snapshot.colors : regexBrand.colors,
        logoUrl: snapshot.logoUrl ?? regexBrand.logoUrl,
        photoUrls: snapshot.photoUrls,
        partnerLogoUrls: snapshot.partnerLogoUrls
      },
      screenshot: snapshot.screenshot,
      logoCrop: snapshot.logoCrop
    }
  } catch {
    // A prospect whose site blocks headless browsers or times out should
    // still get a concept, just without the before/after or DOM-derived brand.
    return { brand: regexBrand, screenshot: null, logoCrop: null }
  }
}

// A no-website prospect is the prime target — there's nothing to scrape, so
// the concept is grounded in the Places data alone.
export interface ScrapedBrand {
  brand: ExtractedBrand
  screenshot: Buffer | null
  logoCrop: Buffer | null
}

async function resolveScrapedBrand(prospect: Prospect): Promise<ScrapedBrand> {
  if (!prospect.website) {
    return {
      brand: {
        businessName: prospect.name, headline: null, services: [], phone: prospect.phone, colors: [],
        logoUrl: null, photoUrls: [], license: null, certifications: [], partnerLogoUrls: []
      },
      screenshot: null, logoCrop: null
    }
  }
  const regexBrand = await extractBrand(prospect.website)
  return captureBrand(prospect.website, regexBrand)
}

// Scrape-only, no persistence — backs the dashboard's brand-review step so
// the operator can see and correct what got extracted before a generation is
// spent on it. Same zero-Anthropic-token posture as previewGeneration below;
// this just doesn't build the full generation context either.
export async function scrapeBrand(prospectId: string): Promise<ExtractedBrand> {
  const prospect = await getProspect(prospectId)
  if (!prospect) throw new Error('Prospect not found')
  const { brand } = await resolveScrapedBrand(prospect)
  return brand
}

// Shared prompt-builder opts, factored out so both buildPrompt (HTML) and
// buildImagePrompt (real generated PNG) take identical art-direction input —
// the two formats should look like the same design, not diverge because one
// prompt path drifted from the other.
interface PromptOpts {
  notes?: string; styleNotes?: string; rating?: number | null; reviewCount?: number | null
  hasScreenshot: boolean; hasLogoCrop: boolean; referenceCount: number
  hasPrimaryReference?: boolean
  // buildImagePrompt only — the image is an internal layout draft for the HTML
  // pass rather than something a prospect will ever see, which changes what to
  // spend fidelity on (composition, not legible body copy).
  forLayoutReference?: boolean
  // buildPrompt only — a layout draft image was generated for this business
  // and sits at index 0 of the images array, ahead of the library references.
  hasGeneratedLayout?: boolean
  // buildPrompt only — literal placeholder strings (not URLs) standing in for
  // AI-generated stock photography, swapped for the real base64 data AFTER
  // Claude returns its HTML. See generateStockPhotos and the substitution
  // step in generateMockup. Present only when the operator opted into AI
  // photography instead of the business's own scraped photos.
  aiPhotoPlaceholders?: string[]
}

interface GenerationAssets {
  brand: ExtractedBrand
  screenshot: Buffer | null
  references: DesignReference[]
  images: VisionImage[]
  promptOpts: PromptOpts
}

// Everything both concept formats need EXCEPT the terminal prompt string:
// resolved brand (scraped + operator override), design references (primary
// sorted first), logo crop, current-site screenshot, and the shared prompt
// options both buildPrompt() and buildImagePrompt() consume identically.
async function assembleGenerationAssets(
  prospect: Prospect,
  opts: {
    directionNotes?: string; styleNotes?: string; libraryId?: string | null
    primaryReferenceId?: string | null; brandOverride?: Partial<ExtractedBrand>
    aiPhotoPlaceholders?: string[]
  },
  // Reuses a scrape the caller already performed. Without this the wizard
  // would load the prospect's site twice through Playwright — once to get the
  // brand colours the stock-photo prompt needs, once here — which is ~10s and
  // a second full-page screenshot for no gain.
  prescraped?: ScrapedBrand
): Promise<GenerationAssets> {
  const { brand: scrapedBrand, screenshot, logoCrop } = prescraped ?? await resolveScrapedBrand(prospect)

  // Operator corrections from the dashboard's brand-review step win over
  // anything scraped — this is the whole point of letting them see and fix a
  // bad extraction before a generation is spent on it.
  const brand: ExtractedBrand = { ...scrapedBrand, ...opts.brandOverride }

  const references = await selectReferencesForLibrary(opts.libraryId, opts.primaryReferenceId)
  const images: VisionImage[] = []
  for (const reference of references) {
    // selectReferencesForLibrary sorts the chosen primary to index 0, so the
    // caption can call it out as the layout to follow rather than one of four
    // equal inputs the model will average together.
    const isPrimary = !!opts.primaryReferenceId && reference.id === opts.primaryReferenceId
    try {
      images.push({
        buffer: await getReferenceImage(reference.storagePath),
        mediaType: mediaTypeFor(reference.contentType),
        caption: isPrimary
          ? `PRIMARY design reference — "${reference.label}". Follow THIS image's layout and composition closely; the other references are secondary style influence only.${reference.notes ? ` Designer's note: ${reference.notes}` : ''}`
          : `Design reference (secondary) — "${reference.label}"${reference.notes ? `. Designer's note: ${reference.notes}` : ''}`
      })
    } catch {
      // A reference whose blob has gone missing shouldn't sink the generation.
    }
  }
  // Sent even when brandOverride replaced the logo URL with something else —
  // the crop is visual grounding for style/color, not a claim about the URL
  // the final page will actually load.
  if (logoCrop) {
    images.push({
      buffer: logoCrop,
      mediaType: 'image/png',
      caption: `Their actual logo, cropped from their live site — reproduce its wordmark treatment and colors, do not redraw or reinterpret it.`
    })
  }
  if (screenshot) {
    images.push({
      buffer: screenshot,
      mediaType: 'image/png',
      caption: `The business's CURRENT website (${prospect.website}) — for brand context, not to imitate.`
    })
  }

  const promptOpts: PromptOpts = {
    notes: opts.directionNotes,
    styleNotes: opts.styleNotes,
    rating: prospect.rating,
    reviewCount: prospect.reviewCount,
    hasScreenshot: !!screenshot,
    hasLogoCrop: !!logoCrop,
    referenceCount: references.length,
    hasPrimaryReference: !!opts.primaryReferenceId && references.some(r => r.id === opts.primaryReferenceId),
    aiPhotoPlaceholders: opts.aiPhotoPlaceholders
  }

  return { brand, screenshot, references, images, promptOpts }
}

// HTML concept context — assembles assets, then builds the HTML-authoring
// prompt (buildPrompt). Used by both generateMockup and previewGeneration so
// the two can never quietly diverge.
async function buildGenerationContext(
  prospect: Prospect,
  opts: {
    directionNotes?: string; styleNotes?: string; libraryId?: string | null
    primaryReferenceId?: string | null; brandOverride?: Partial<ExtractedBrand>
    aiPhotoPlaceholders?: string[]
  },
  prescraped?: ScrapedBrand
): Promise<GenerationContext> {
  const assets = await assembleGenerationAssets(prospect, opts, prescraped)
  const prompt = buildPrompt(assets.brand, prospect.name, prospect.category, assets.promptOpts)
  return { ...assets, prompt }
}

// Real generated PNG concept context — same assets, same art direction, but
// buildImagePrompt() instead (no HTML/CSS technical section, single prompt
// string since images.edit() has no separate system slot).
async function buildImageGenerationContext(
  prospect: Prospect,
  opts: {
    directionNotes?: string; styleNotes?: string; libraryId?: string | null
    primaryReferenceId?: string | null; brandOverride?: Partial<ExtractedBrand>
  }
): Promise<GenerationContext> {
  const assets = await assembleGenerationAssets(prospect, opts)
  const prompt = buildImagePrompt(assets.brand, prospect.name, prospect.category, assets.promptOpts)
  return { ...assets, prompt }
}

// Layout-first: generate a full-page design image for THIS business, then hand
// it to the HTML pass as the layout spec.
//
// Why it beats going straight to HTML: the reference library holds generic
// stock sites, and asking one vision call to average eight of them into a
// layout is what produces safely-generic pages. A mockup generated for this
// business collapses that into ONE unambiguous target — and the "primary
// reference" slot that already exists in buildPrompt is exactly the shape
// needed to feed it in, so this is a new front half, not a new pipeline.
//
// The split of responsibility is the whole trick, and it's why the image's
// well-known weakness doesn't matter: the image supplies layout only, while
// every word, hex value, phone number and rating still comes from the scraped
// brand text that the HTML pass already receives. Image models garble copy
// (real output: "GET A EREE ESTINATE", a Google rating of "49"), so
// buildPrompt tells the model in as many words not to read text off it.
//
// Costs an image generation on top of the Claude call, and roughly doubles
// wall time — hence opt-in per generation rather than the default path.
async function buildLayoutFirstContext(
  prospect: Prospect,
  opts: {
    directionNotes?: string; styleNotes?: string; libraryId?: string | null
    primaryReferenceId?: string | null; brandOverride?: Partial<ExtractedBrand>
    aiPhotoPlaceholders?: string[]
  },
  prescraped?: ScrapedBrand,
  progress?: GenerationProgress
): Promise<GenerationContext & { layoutImage: GeneratedImage }> {
  const assets = await assembleGenerationAssets(prospect, opts, prescraped)

  const imagePrompt = buildImagePrompt(assets.brand, prospect.name, prospect.category, {
    ...assets.promptOpts,
    forLayoutReference: true
  })
  await progress?.begin('layout', 30_000)
  const layout = await generateMockupImage(imagePrompt, assets.images, { shape: 'full-page', tier: 'draft' })
  await progress?.addCost({ step: 'layout', provider: 'gemini', model: layout.model, kind: 'image', qty: 1, micros: layout.costMicros })
  await progress?.finish('layout', `Drew a full-page layout with ${layout.model}`)

  // Prepended, so it lands at index 0 where buildPrompt's "IMAGE 1" callout
  // expects it and every later "image N" index shifts by one.
  const images: VisionImage[] = [
    {
      buffer: layout.buffer,
      mediaType: layout.mediaType,
      caption:
        `Generated full-page design mockup of ${assets.brand.businessName ?? prospect.name}'s new homepage — ` +
        `THE LAYOUT SPEC for the page you are writing. Its composition is authoritative; its text is not ` +
        `(an image model drew it), so take copy from the prompt, never from this image.`,
    },
    ...assets.images
  ]

  const promptOpts: PromptOpts = { ...assets.promptOpts, hasGeneratedLayout: true }
  const prompt = buildPrompt(assets.brand, prospect.name, prospect.category, promptOpts)
  return { ...assets, images, prompt, layoutImage: layout }
}

// ── Design analysis (two-pass) ───────────────────────────────────────────────
// A single vision call writing HTML directly from reference IMAGES tends to
// average them into something generic — it can describe "modern and clean"
// but not reliably translate a specific layout pattern or contrast level into
// CSS while also juggling structure/honesty/tokens rules. Splitting analysis
// from generation fixes both problems this was built to catch: it gives the
// model a dedicated pass whose only job is to look and describe (not also
// write code), and it re-derives the services list from what's ACTUALLY
// visible instead of trusting the regex scrape, which is what let "Tampa Roof
// Repair" (the business's own name) get listed as one of its own services.
// Runs on the cheap model tier — a real (small) cost, unlike scrapeBrand/
// previewGeneration, so it's a separate explicit action, not automatic.

export interface DesignAnalysis {
  services: string[]
  styleNotes: string
}

const ANALYSIS_SYSTEM_PROMPT = `You are a design analyst helping a web designer plan a homepage concept
for a prospective client. You will be shown design reference images (the target visual style), possibly
the client's actual logo, and a screenshot of their CURRENT website. Do not write any HTML or CSS — respond
with plain text analysis only, in exactly this format:

SERVICES:
- <service>
(One per line. Only real services this business appears to actually offer, verified against the
screenshot and any scraped list you're given. Drop anything that's actually the business's own name, a
tagline, or a marketing sentence rather than a real service or offering. If you can't identify any
services with confidence, write exactly "none identified" as the only line.)

STYLE:
- <note>
(3-6 short, concrete, actionable bullets covering: the design references' layout pattern, typography
personality, spacing density, colour contrast level (light-and-airy vs dark-and-bold — call this out
explicitly), and icon/imagery style — plus 1-2 specific weaknesses of the CURRENT site the new concept
should fix. Prefer concrete direction ("dark navy hero, bold orange CTA, generous whitespace") over vague
adjectives ("modern and clean").)`

function parseDesignAnalysis(raw: string, fallbackServices: string[]): DesignAnalysis {
  const servicesBlock = raw.match(/SERVICES:\s*([\s\S]*?)(?:\n\s*STYLE:|$)/i)?.[1] ?? ''
  const styleBlock = raw.match(/STYLE:\s*([\s\S]*)$/i)?.[1] ?? raw

  const services = servicesBlock
    .split('\n')
    .map(l => l.replace(/^[-*•]\s*/, '').trim())
    .filter(l => l && !/^none identified$/i.test(l))

  return {
    services: services.length ? services : fallbackServices,
    styleNotes: styleBlock.trim()
  }
}

// Reuses buildGenerationContext for the exact same images/brand a real
// generation would see — same reasoning as previewGeneration's zero-drift
// guarantee, just for the analysis pass instead of the HTML write-up.
export async function analyzeDesign(
  prospectId: string,
  opts: {
    libraryId?: string | null; primaryReferenceId?: string | null
    brandOverride?: Partial<ExtractedBrand>
    onUsage?: UsageSink
  } = {}
): Promise<DesignAnalysis> {
  if (!mockupsConfigured()) throw new Error('ANTHROPIC_API_KEY is not configured on this deployment')
  const prospect = await getProspect(prospectId)
  if (!prospect) throw new Error('Prospect not found')

  const ctx = await buildGenerationContext(prospect, opts)
  const prompt = `Analyze the design references and current site for ${ctx.brand.businessName ?? prospect.name} ` +
    `(${prospect.category ?? 'a local business'}). Services scraped so far, to verify or correct: ` +
    `${ctx.brand.services.length ? ctx.brand.services.join(', ') : 'none extracted'}.`

  const raw = await completeWithImages(prompt, ctx.images, { system: ANALYSIS_SYSTEM_PROMPT, tier: 'cheap', maxTokens: 700, onUsage: opts.onUsage })
  return parseDesignAnalysis(raw, ctx.brand.services)
}

// Generates a NEW row every time — "regenerate" is just calling this again, so
// a preview link that's already been shared keeps rendering the concept that
// was actually sent rather than silently changing under the prospect.
export async function generateMockup(
  prospectId: string,
  opts: {
    styleKey?: string; directionNotes?: string; styleNotes?: string
    libraryId?: string | null; primaryReferenceId?: string | null
    brandOverride?: Partial<ExtractedBrand>
    // Draw a full-page design image for this business first and use it as the
    // layout spec for the HTML. See buildLayoutFirstContext.
    layoutFirst?: boolean
    // Generate clean stock-style photography instead of reusing the business's
    // own scraped photos. See generateStockPhotos — worth it when their real
    // imagery is low-quality, badly cropped, or has text burned into it.
    aiPhotos?: boolean
    // Optional progress/cost sink. Absent for the advanced per-step buttons,
    // supplied by the wizard.
    progress?: GenerationProgress
  } = {}
): Promise<ProspectMockup> {
  if (!mockupsConfigured()) throw new Error('ANTHROPIC_API_KEY is not configured on this deployment')
  if ((opts.layoutFirst || opts.aiPhotos) && !imageGenConfigured()) {
    throw new Error('Image generation needs GEMINI_API_KEY or OPENAI_API_KEY, neither of which is configured on this deployment')
  }

  const prospect = await getProspect(prospectId)
  if (!prospect) throw new Error('Prospect not found')

  // Scraped once, up front, and reused for both the stock-photo prompt (which
  // wants the brand colours) and the context build.
  const progress = opts.progress
  await progress?.begin('brand', 12_000)
  const prescraped = await resolveScrapedBrand(prospect)
  const brand: ExtractedBrand = { ...prescraped.brand, ...opts.brandOverride }
  await progress?.finish('brand', brand.businessName
    ? `Found ${brand.businessName}${brand.services.length ? `, ${brand.services.length} services` : ''}`
    : 'No brand details could be scraped')

  // Generated ahead of the context build so the placeholder tokens can go into
  // the prompt Claude actually sees. The real bytes never reach Claude — only
  // these short tokens do, and embedStockPhotos swaps them afterwards.
  let stockPhotos: StockPhoto[] = []
  if (opts.aiPhotos) {
    await progress?.begin('photos', 45_000)
    stockPhotos = await generateStockPhotos(brand, prospect.category)
    for (const p of stockPhotos) {
      await progress?.addCost({ step: 'photos', provider: 'gemini', model: p.image.model, kind: 'image', qty: 1, micros: p.image.costMicros })
    }
    await progress?.finish('photos', `Generated ${stockPhotos.length} photos`)
  } else {
    await progress?.skip('photos', "Using the business's own photos")
  }
  const aiPhotoPlaceholders = stockPhotos.map((_, i) => stockPhotoPlaceholder(i + 1))
  const ctxOpts = { ...opts, brandOverride: brand, aiPhotoPlaceholders: aiPhotoPlaceholders.length ? aiPhotoPlaceholders : undefined }

  let ctx: GenerationContext
  let layoutImage: GeneratedImage | null = null
  if (opts.layoutFirst) {
    const layoutCtx = await buildLayoutFirstContext(prospect, ctxOpts, prescraped, progress)
    ctx = layoutCtx
    layoutImage = layoutCtx.layoutImage
  } else {
    await progress?.skip('layout', 'Skipped — building HTML straight from the references')
    ctx = await buildGenerationContext(prospect, ctxOpts, prescraped)
  }

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

  // Kept so the operator can compare the page against the draft it was built
  // from and tell whether a disappointing concept came from a bad layout or a
  // bad translation of a good one. Best-effort: the image is already spent, so
  // a storage hiccup here shouldn't throw away the concept it produced.
  let layoutImagePath: string | null = null
  if (layoutImage) {
    const path = `${prospectId}/${randomUUID()}.${extFor(layoutImage.mediaType)}`
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, layoutImage.buffer, { contentType: layoutImage.mediaType, upsert: false })
    if (!error) layoutImagePath = path
  }

  await progress?.begin('html', 75_000)
  let stopReason: string | null = null
  const raw = await completeWithImages(ctx.prompt, ctx.images, {
    system: SYSTEM_PROMPT,
    maxTokens: HTML_MAX_TOKENS,
    onUsage: u => { void progress?.addCost({ step: 'html', provider: 'anthropic', model: u.model, kind: 'tokens', qty: u.inputTokens + u.outputTokens, micros: claudeCostMicros(u.model, u) }) },
    onStopReason: r => { stopReason = r },
  })
  // A truncated page is the one failure nothing downstream can see: browsers
  // auto-close unterminated tags, so it renders (badly, missing everything
  // below the cut) and even passes the layout audit. Only the stop reason
  // distinguishes it from a finished page, so it has to be checked here.
  if (stopReason === 'max_tokens') {
    throw new Error(
      `Concept generation was cut off after ${HTML_MAX_TOKENS} output tokens — the page is incomplete. Retry, or simplify the direction notes if it keeps happening.`
    )
  }
  const generatedHtml = stripCodeFence(raw)
  if (!generatedHtml.toLowerCase().includes('<html')) throw new Error('Concept generation did not return a complete HTML document')
  // Guards against a stop reason this code doesn't know about producing the
  // same silent half-page: a finished document always closes its root tag.
  if (!/<\/html\s*>/i.test(generatedHtml)) {
    throw new Error(`Concept generation returned an unterminated HTML document (stop reason: ${stopReason ?? 'unknown'})`)
  }
  await progress?.finish('html', `Wrote ${(generatedHtml.length / 1024).toFixed(0)}KB of HTML`)

  // Placeholder tokens -> real base64 data URIs. Done here rather than by the
  // model because a single photo's base64 exceeds the whole output budget.
  const html = stockPhotos.length ? embedStockPhotos(generatedHtml, stockPhotos) : generatedHtml
  if (stockPhotos.length && html.includes('AI_STOCK_PHOTO_')) {
    // A leftover token would render as a broken image in the prospect's
    // browser — better to fail loudly here than ship a visibly broken page.
    throw new Error('Concept generation left an unreplaced AI photo placeholder in the HTML')
  }

  // Advisory only: measured in a real browser, recorded, never used to rewrite
  // the model's HTML. Wrapped because a concept that already cost money must
  // not be lost to an audit failure.
  await progress?.begin('audit', 12_000)
  let layoutFindings: LayoutFinding[] = []
  try {
    layoutFindings = await auditConceptLayout(html)
  } catch { /* audit is diagnostic; never fatal */ }
  await progress?.finish('audit', layoutFindings.length
    ? `${layoutFindings.length} alignment issue(s) to review`
    : 'No alignment issues found')

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
      layout_image_path: layoutImagePath,
      layout_findings: layoutFindings,
      current_screenshot_path: currentScreenshotPath,
      reference_ids: ctx.references.map(r => r.id),
      library_id: opts.libraryId ?? null,
      model: process.env.ANTHROPIC_CONTENT_MODEL ?? 'claude-sonnet-5'
    })
    .select()
    .single()
  if (error) throw new Error(`Failed to record mockup: ${error.message}`)
  return fromRow(data as Row)
}

// Real generated PNG concept — parallel to generateMockup above, same
// upload-and-insert shape, but format: 'image'. storage_path upload to
// BUCKET was dead code since the gpt-image-1 era ended (HTML concepts never
// wrote to it); this is the first real writer since that pivot.
export async function generateImageMockup(
  prospectId: string,
  opts: {
    directionNotes?: string; styleNotes?: string
    libraryId?: string | null; primaryReferenceId?: string | null
    brandOverride?: Partial<ExtractedBrand>
  } = {}
): Promise<ProspectMockup> {
  if (!imageGenConfigured()) throw new Error('Image generation needs GEMINI_API_KEY or OPENAI_API_KEY, neither of which is configured on this deployment')

  const prospect = await getProspect(prospectId)
  if (!prospect) throw new Error('Prospect not found')

  const ctx = await buildImageGenerationContext(prospect, opts)

  let currentScreenshotPath: string | null = null
  if (ctx.screenshot) {
    currentScreenshotPath = `${prospectId}/${randomUUID()}.png`
    const { error } = await supabase.storage
      .from(SCREENSHOT_BUCKET)
      .upload(currentScreenshotPath, ctx.screenshot, { contentType: 'image/png', upsert: false })
    if (error) currentScreenshotPath = null
  }

  const generated = await generateMockupImage(ctx.prompt, ctx.images, { shape: 'full-page', tier: 'final' })

  const storagePath = `${prospectId}/${randomUUID()}.${extFor(generated.mediaType)}`
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, generated.buffer, { contentType: generated.mediaType, upsert: false })
  if (uploadError) throw new Error(`Failed to store generated image: ${uploadError.message}`)

  const { data, error } = await supabase
    .from('prospect_mockups')
    .insert({
      prospect_id: prospectId,
      style_key: STYLES[0].key,
      brand: ctx.brand,
      prompt: ctx.prompt,
      direction_notes: opts.directionNotes ?? null,
      format: 'image',
      storage_path: storagePath,
      current_screenshot_path: currentScreenshotPath,
      reference_ids: ctx.references.map(r => r.id),
      library_id: opts.libraryId ?? null,
      model: generated.model
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
  opts: {
    directionNotes?: string; styleNotes?: string
    libraryId?: string | null; primaryReferenceId?: string | null
    brandOverride?: Partial<ExtractedBrand>
  } = {}
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

// Free preview for the image path — same zero-cost posture as
// previewGeneration above, doubly worth it here since a real image
// generation costs money regardless of whether the result is any good.
// systemPrompt is empty since images.edit() has no separate system slot —
// buildImagePrompt() already folds that framing into the one prompt string.
export async function previewImageMockup(
  prospectId: string,
  opts: {
    directionNotes?: string; styleNotes?: string
    libraryId?: string | null; primaryReferenceId?: string | null
    brandOverride?: Partial<ExtractedBrand>
  } = {}
): Promise<MockupPreview> {
  const prospect = await getProspect(prospectId)
  if (!prospect) throw new Error('Prospect not found')

  const ctx = await buildImageGenerationContext(prospect, opts)

  return {
    systemPrompt: '',
    userPrompt: ctx.prompt,
    combinedPrompt: ctx.prompt,
    images: ctx.images.map((img, i) => ({
      caption: img.caption,
      filename: filenameFor(i, img.caption),
      dataUrl: `data:${img.mediaType};base64,${img.buffer.toString('base64')}`
    }))
  }
}

// The stored extension is the only record of what these bytes are, since the
// provider decides the format. Routes use this instead of hardcoding png.
export function contentTypeForStoredImage(storagePath: string): string {
  if (storagePath.endsWith('.jpg')) return 'image/jpeg'
  if (storagePath.endsWith('.webp')) return 'image/webp'
  if (storagePath.endsWith('.gif')) return 'image/gif'
  return 'image/png'
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

// ── The one-click wizard ─────────────────────────────────────────────────────
// Everything the operator used to click through by hand — scrape, design
// analysis, layout draft, stock photos, HTML, layout audit — as one run whose
// progress and spend are written to a row the dashboard polls.
//
// Deliberately NOT a second generation implementation: after the analysis pass
// it calls the same generateMockup() the advanced buttons call, passing a
// progress sink. Two code paths that drift is exactly how the "why does the
// wizard produce different output?" class of bug starts.
//
// Runs detached from the request that started it (see the route), so an
// operator closing the tab or a proxy timing out doesn't kill a job that is
// spending real money.

export const WIZARD_STEPS: { key: string; label: string }[] = [
  { key: 'brand',    label: 'Scrape brand & photos' },
  { key: 'analyze',  label: 'Analyse design references' },
  { key: 'photos',   label: 'Generate photography' },
  { key: 'layout',   label: 'Draw full-page layout' },
  { key: 'html',     label: 'Build the page' },
  { key: 'audit',    label: 'Check layout' },
]

export interface WizardOptions {
  libraryId?: string | null
  primaryReferenceId?: string | null
  directionNotes?: string
  brandOverride?: Partial<ExtractedBrand>
  aiPhotos?: boolean
  layoutFirst?: boolean
}

export async function runConceptWizard(
  prospectId: string,
  progress: GenerationProgress,
  opts: WizardOptions
): Promise<ProspectMockup> {
  const prospect = await getProspect(prospectId)
  if (!prospect) throw new Error('Prospect not found')

  // The analysis pass corrects the scraped services list and produces concrete
  // art direction. It runs on the cheap tier and materially improves the
  // concept, so the wizard always does it rather than leaving it to a separate
  // button the operator might forget.
  await progress.begin('analyze', 20_000)
  let styleNotes = ''
  let services: string[] | undefined
  try {
    const analysis = await analyzeDesign(prospectId, {
      libraryId: opts.libraryId,
      primaryReferenceId: opts.primaryReferenceId,
      brandOverride: opts.brandOverride,
      onUsage: u => { void progress.addCost({ step: 'analyze', provider: 'anthropic', model: u.model, kind: 'tokens', qty: u.inputTokens + u.outputTokens, micros: claudeCostMicros(u.model, u) }) },
    })
    styleNotes = analysis.styleNotes
    services = analysis.services
    await progress.finish('analyze', `${analysis.services.length} services confirmed`)
  } catch (err) {
    // A failed analysis costs the concept its art direction, not its life —
    // generation still works from the references alone.
    await progress.skip('analyze', `Skipped: ${err instanceof Error ? err.message : 'analysis failed'}`)
  }

  return generateMockup(prospectId, {
    libraryId: opts.libraryId,
    primaryReferenceId: opts.primaryReferenceId,
    directionNotes: opts.directionNotes,
    styleNotes: styleNotes || undefined,
    // The analysis's corrected services win over the raw scrape, matching what
    // the dashboard does when the operator runs the two steps by hand.
    brandOverride: services?.length ? { ...opts.brandOverride, services } : opts.brandOverride,
    aiPhotos: opts.aiPhotos ?? true,
    layoutFirst: opts.layoutFirst ?? true,
    progress,
  })
}
