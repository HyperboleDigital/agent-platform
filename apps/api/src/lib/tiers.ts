import type { ServiceKey } from './services'
import type { Vertical } from '@agent-platform/shared'

// The finalized Hyperbole Digital pricing sheet — two verticals, three tiers
// each. Each tier now maps to a real Stripe recurring price (`stripePriceId`,
// from env — created 2026-07-24), the same way lib/billing.ts's PLANS and
// lib/services.ts's CATALOG are keyed by Stripe price IDs. `tierForPriceId()`
// reverse-maps a Stripe price back to its tier (used by the webhook), mirroring
// planForPriceId / serviceForPriceId. A price ID is '' if its env var isn't set
// (e.g. a deploy without the tier prices) — treat an unset price as "not
// purchasable via checkout yet," never as a match.
//
// `includes` maps a tier to the ServiceKeys it should entitle (see
// lib/entitlements.ts — a client's assigned tier is a third entitlement
// source, alongside Stripe add-ons and superadmin comps). This is a
// best-effort mapping onto what the platform actually has *today*: a tier can
// promise more on the sheet than the dashboard currently delivers.
//
// `features` is the literal sheet copy. Every bullet is something the client
// IS paying for and IS receiving — most of this service is delivered by hand,
// so a bullet without a dashboard view is not a missing feature, just work
// that has no widget. `built` therefore means only "this has live data in the
// dashboard", and is used to offer a deep link (and to tell Owen what's wired
// up) — never to imply to a client that they aren't getting something. Set
// `built: true` only when the WHOLE bullet has data: a bullet promising three
// AI engines when we track two stays false.
//
// `section` is the client-dashboard route segment holding that data ('' = the
// client home page). Only meaningful when `built` is true.

export interface TierFeature {
  text: string
  built: boolean
  section?: string
}

export interface TierInfo {
  key: string
  vertical: Vertical
  name: string
  monthlyPriceCents: number
  stripePriceId: string // '' when the env var for this tier's price isn't set
  includes: ServiceKey[]
  quotas: {
    pagesPerMonth: number
    contentPiecesPerMonth: number
  }
  features: TierFeature[]
}

const CATALOG: TierInfo[] = [
  // ── Local Services (Offer Sheet A) ──────────────────────────────────────
  {
    key: 'local-care',
    vertical: 'local',
    name: 'Care',
    monthlyPriceCents: 49500,
    stripePriceId: process.env.STRIPE_PRICE_TIER_LOCAL_CARE ?? '',
    includes: [],
    quotas: { pagesPerMonth: 0, contentPiecesPerMonth: 0 },
    features: [
      // site-health-card.tsx covers uptime + SSL. Backups are Webflow/Framer's,
      // deliberately not tracked here (Owen's call).
      { text: 'Hosting, security, uptime monitoring, backups', built: true, section: '' },
      // Change requests exist; the turnaround SLA timer and the one-active-at-a-time
      // limit are not enforced yet.
      { text: 'Unlimited small requests — 1–2 business day turnaround, one active request at a time', built: true, section: 'requests' },
      { text: 'Technical SEO baseline: page speed, meta titles/descriptions, schema markup, mobile, indexing health', built: false },
      { text: 'Monthly health report', built: false }
    ]
  },
  {
    key: 'local-seo',
    vertical: 'local',
    name: 'Local SEO',
    monthlyPriceCents: 120000,
    stripePriceId: process.env.STRIPE_PRICE_TIER_LOCAL_SEO ?? '',
    includes: ['seo', 'local'],
    quotas: { pagesPerMonth: 1, contentPiecesPerMonth: 0 },
    features: [
      { text: 'Everything in Care', built: true },
      { text: 'Keyword research and ranking strategy for the service area', built: false },
      { text: 'On-page optimization across existing pages', built: true, section: 'seo' }, // full-site crawl audit
      { text: '1 optimized service or location page per month', built: false }, // no quota tracking yet
      { text: 'Competitor rank tracking', built: false }, // needs a paid SERP API
      { text: 'Google Business Profile: weekly posts, category/service optimization, photos, Q&A', built: true, section: 'local' }, // gbp_activity log
      { text: 'Citation building and NAP consistency across 40+ directories', built: true, section: 'local' }, // citations tracker + NAP diffing
      { text: 'Review generation automation and response management', built: false }, // needs GBP API
      // NOT built: lib/visibility.ts tracks OpenAI + Anthropic only. This bullet
      // names Perplexity and Google AI Overviews too, so it stays false until
      // those two engines are actually tracked.
      { text: 'AI search visibility (GEO): entity/schema optimization, FAQ content, llms.txt, monthly citation tracking (ChatGPT, Perplexity, Google AI Overviews)', built: false },
      { text: 'Dashboard: keyword positions, map pack rankings, AI citations, calls, form fills', built: false },
      { text: 'Quarterly strategy call', built: false }
    ]
  },
  {
    key: 'local-growth',
    vertical: 'local',
    name: 'Local SEO + Growth',
    monthlyPriceCents: 240000,
    stripePriceId: process.env.STRIPE_PRICE_TIER_LOCAL_GROWTH ?? '',
    includes: ['seo', 'content', 'local', 'chat'],
    quotas: { pagesPerMonth: 3, contentPiecesPerMonth: 3 },
    features: [
      { text: 'Everything in Local SEO', built: true },
      // content.ts generation/publish flow is real; the 3/mo quota isn't enforced.
      { text: '3 pages per month — service pages, location pages, question-intent blog content', built: true, section: 'content' },
      { text: 'Link building: local partnerships, chambers of commerce, industry associations, suppliers, sponsorships', built: false },
      { text: 'Ongoing technical SEO: audits, Core Web Vitals, internal linking', built: false },
      { text: 'Expanded GEO: presence building on the third-party sources AI engines cite', built: false },
      // The core chatbot + leads table. Booking is Calendly-link-only.
      { text: 'AI chatbot: FAQs, lead capture, appointment booking, after-hours coverage', built: true, section: 'assistant' },
      { text: 'Call tracking and lead attribution', built: false },
      { text: 'Monthly strategy call', built: false }
    ]
  },
  // ── B2B (Offer Sheet B) ──────────────────────────────────────────────────
  {
    key: 'b2b-care',
    vertical: 'b2b',
    name: 'Care',
    monthlyPriceCents: 79500,
    stripePriceId: process.env.STRIPE_PRICE_TIER_B2B_CARE ?? '',
    includes: [],
    quotas: { pagesPerMonth: 0, contentPiecesPerMonth: 0 },
    features: [
      { text: 'Hosting, security, uptime monitoring, backups', built: true, section: '' },
      { text: 'Unlimited small requests — same turnaround terms as Local Care', built: true, section: 'requests' },
      { text: 'Technical SEO baseline', built: false },
      { text: 'Monthly health report', built: false }
    ]
  },
  {
    key: 'b2b-momentum',
    vertical: 'b2b',
    name: 'Momentum',
    monthlyPriceCents: 250000,
    stripePriceId: process.env.STRIPE_PRICE_TIER_B2B_MOMENTUM ?? '',
    includes: ['seo', 'content'],
    quotas: { pagesPerMonth: 0, contentPiecesPerMonth: 3 },
    features: [
      { text: 'Everything in Care', built: true },
      { text: 'Buyer-intent keyword strategy (problem-aware and solution-aware, not just product names)', built: false },
      { text: 'Technical SEO and site architecture built for topical authority', built: false },
      { text: '3 content pieces per month: application notes, comparison pages, spec/product pages, use cases', built: true, section: 'content' },
      { text: 'Competitor visibility tracking', built: false },
      // Same reason as the local GEO bullet — citation tracking is partial.
      { text: 'AI search visibility (GEO): entity optimization, structured buyer-question content, llms.txt + product/spec schema, monthly citation tracking', built: false },
      // The chatbot answers from the knowledge base and captures leads, but has
      // no qualification scoring and no CRM routing.
      { text: 'AI sales agent: answers technical questions, qualifies visitors, routes leads with full context', built: false },
      { text: 'Dashboard: rankings, AI citations, traffic, leads, conversion paths', built: false },
      { text: 'Monthly call', built: false }
    ]
  },
  {
    key: 'b2b-growth',
    vertical: 'b2b',
    name: 'Growth Partner',
    monthlyPriceCents: 450000,
    stripePriceId: process.env.STRIPE_PRICE_TIER_B2B_GROWTH ?? '',
    includes: ['seo', 'content', 'chat'],
    quotas: { pagesPerMonth: 0, contentPiecesPerMonth: 6 },
    features: [
      { text: 'Everything in Momentum', built: true },
      { text: '6 content pieces per month plus content strategy tied to the sales cycle', built: true, section: 'content' },
      { text: 'Link building and digital PR: trade publications, industry associations, supplier networks', built: false },
      // NOTE: email nurture sequences are scheduler-driven automated sending,
      // which collides head-on with the 582-email guardrail. Needs an explicit
      // decision before it's built, not just a build ticket.
      { text: 'Email nurture sequences with automated lead scoring', built: false },
      { text: 'Trade show campaign support: landing pages, follow-up automation, list capture', built: false },
      { text: 'CRM integration and lead attribution', built: false },
      { text: 'Bi-weekly strategy calls', built: false }
    ]
  }
]

const BY_KEY: Record<string, TierInfo> = Object.fromEntries(CATALOG.map(t => [t.key, t]))

// Keyed by Stripe price ID for reverse lookup from a subscription item — same
// pattern as billing.ts's planForPriceId and services.ts's serviceForPriceId.
// Only tiers with a configured price are indexed, so an unset ('') price can
// never accidentally match.
const BY_PRICE_ID: Record<string, TierInfo> = Object.fromEntries(
  CATALOG.filter(t => t.stripePriceId).map(t => [t.stripePriceId, t])
)

export function tierForKey(key: string | null | undefined): TierInfo | null {
  if (!key) return null
  return BY_KEY[key] ?? null
}

export function tierForPriceId(priceId: string | null | undefined): TierInfo | null {
  if (!priceId) return null
  return BY_PRICE_ID[priceId] ?? null
}

export function listTiers(): TierInfo[] {
  return CATALOG
}

export function tiersForVertical(vertical: Vertical): TierInfo[] {
  return CATALOG.filter(t => t.vertical === vertical)
}
