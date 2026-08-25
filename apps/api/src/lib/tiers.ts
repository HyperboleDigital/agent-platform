import type { ServiceKey } from './services'

// The Hyperbole Digital pricing sheet — ONE ladder of three tiers (restructured
// 2026-08-18; the old Local/B2B vertical split is gone). Each tier maps to a
// real Stripe recurring price (`stripePriceId`, from env), the same way
// lib/services.ts's CATALOG is keyed by Stripe price IDs. `tierForPriceId()`
// reverse-maps a Stripe price back to its tier (used by the webhook), mirroring
// serviceForPriceId. A price ID is '' if its env var isn't set — treat an unset
// price as "not purchasable via checkout yet," never as a match.
//
// A tier is a STARTING TEMPLATE, not the whole commercial truth: every client's
// deal is customized on a per-client info sheet via client_line_items (see
// lib/line-items.ts) layered on top of the tier.
//
// `includes` maps a tier to the ServiceKeys it entitles (see
// lib/entitlements.ts — a client's assigned tier is a third entitlement
// source, alongside Stripe add-ons and superadmin comps). Note `local` is no
// longer in any tier — Local Presence became a purchasable $250/mo add-on
// (2026-08-18), offered only where local search matters.
//
// `features` is the literal sheet copy. Every bullet is something the client
// IS paying for and IS receiving — most of this service is delivered by hand,
// so a bullet without a dashboard view is not a missing feature, just work
// that has no widget. `built` therefore means only "this has live data in the
// dashboard", and is used to offer a deep link (and to tell Owen what's wired
// up) — never to imply to a client that they aren't getting something. Set
// `built: true` only when the WHOLE bullet has data.
//
// `section` is the client-dashboard route segment holding that data ('' = the
// client home page). Only meaningful when `built` is true.

export interface TierFeature {
  text: string
  built: boolean
  section?: string
  // Only shown when WE host the client's site (clients.hosting = 'us'). On a
  // client-owned platform (e.g. their own Squarespace) we can't deliver
  // hosting/uptime promises, so the dashboard hides the bullet entirely.
  hostedOnly?: boolean
  // Only shown when the client actually has a chat assistant (chat
  // entitlement). Care doesn't grant chat — this bullet exists for clients
  // whose previously-built bot stays live after a downgrade (retention
  // design, see lib/entitlements.ts chat-at-Care notes).
  chatOnly?: boolean
}

export interface TierInfo {
  key: string
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
  {
    key: 'care',
    name: 'Care',
    // $495 is the FLOOR — validated by a client who's paid it for two years
    // with no chatbot. Never discount below this.
    monthlyPriceCents: 49500,
    stripePriceId: process.env.STRIPE_PRICE_TIER_CARE ?? '',
    includes: [],
    quotas: { pagesPerMonth: 0, contentPiecesPerMonth: 0 },
    features: [
      // site-health-card.tsx covers uptime + SSL. Backups are Webflow/Framer's,
      // deliberately not tracked here (Owen's call). Hidden when the client
      // hosts their own site — we can't act on uptime we don't control.
      { text: 'Hosting, security, uptime monitoring, backups', built: true, section: '', hostedOnly: true },
      // Change requests exist; the turnaround SLA timer and the one-active-at-a-time
      // limit are not enforced yet.
      { text: 'Unlimited small requests — 1–2 business day turnaround, one active request at a time', built: true, section: 'requests' },
      // NOT built as a whole: titles/meta/indexing have live data
      // (site-baseline.ts + the crawl), but this wording now promises schema
      // and sitemap maintenance too — nothing in the dashboard checks
      // structured data, and sitemap health only surfaces inside the
      // AI-Search-Health score. Flip when the whole bullet has data.
      { text: 'Technical SEO baseline maintained: titles, meta, schema, sitemap, indexing health', built: false },
      { text: 'Monthly health report — speed, broken links, indexing, uptime', built: true, section: 'reports' },
      // Care keeps a previously-built chatbot LIVE (answering, logging,
      // capturing leads) — what stops is the managed work: KB retraining,
      // content updates, the unanswered-questions review. Deliberate
      // retention design. Shown only to clients who actually have a bot.
      { text: 'Your AI assistant stays live and answering', built: true, section: 'assistant', chatOnly: true }
    ]
  },
  {
    key: 'seo',
    // Display name only — the key stays 'seo' (referenced across Stripe
    // metadata, entitlements, and reports; renaming it would orphan them all).
    // GEO is the differentiator against commodity SEO agencies, so it belongs
    // in the product name, not buried in a bullet. Price deliberately stays
    // $1,200 until the GEO work (Perplexity + AI Overview tracking + the
    // citation-domain playbook) actually ships — see handoff #2 §0.2.
    name: 'SEO + GEO',
    monthlyPriceCents: 120000,
    stripePriceId: process.env.STRIPE_PRICE_TIER_SEO ?? '',
    includes: ['seo'],
    quotas: { pagesPerMonth: 1, contentPiecesPerMonth: 0 },
    features: [
      { text: 'Everything in Care', built: true },
      // Keyword research (KeywordResearchModal, 2026-07-26) + the target-keyword
      // rank tracker both have live data on the SEO page; the strategy half is
      // delivered by hand as ever.
      { text: 'Keyword research and ranking strategy', built: true, section: 'seo' },
      { text: 'On-page optimization across existing pages', built: true, section: 'seo' }, // full-site crawl audit
      { text: '1 optimized page per month', built: false }, // no quota tracking yet
      // The crawl audit is live, but CWV and internal-linking work have no
      // dashboard surface of their own — bullet stays false until they do.
      { text: 'Ongoing technical SEO: audits, Core Web Vitals, internal linking', built: false },
      // Flipped 2026-08-25: lib/visibility.ts now tracks all four engines —
      // ChatGPT, Claude, Perplexity (native citations), and Google AI
      // Overviews (DataForSEO capture) — live-verified in one run against
      // hyperboledigital.com. llms.txt + schema fix generation ship as
      // change requests; citation runs are weekly on this tier.
      { text: 'AI search visibility (GEO): entity/schema optimization, llms.txt, monthly citation tracking', built: true, section: 'seo' },
      { text: 'Quarterly strategy call', built: false }
    ]
  },
  {
    key: 'growth',
    name: 'Growth',
    monthlyPriceCents: 250000,
    stripePriceId: process.env.STRIPE_PRICE_TIER_GROWTH ?? '',
    includes: ['seo', 'content', 'chat'],
    quotas: { pagesPerMonth: 1, contentPiecesPerMonth: 3 },
    features: [
      { text: 'Everything in SEO + GEO', built: true },
      // content.ts generation/publish flow is real; the 3/mo quota isn't enforced.
      { text: '3 content pieces per month', built: true, section: 'content' },
      // The core chatbot + leads table. Booking is Calendly-link-only.
      { text: 'AI chat assistant: FAQs, lead capture, appointment booking, after-hours coverage', built: true, section: 'assistant' },
      // All four named datasets are live: target-keyword rankings (seo), AI
      // citations (visibility runs), leads, and conversation analytics — the
      // Home summary card surfaces them together.
      { text: 'Dashboard: rankings, AI citations, leads, conversation reporting', built: true, section: '' },
      { text: 'Monthly strategy call', built: false }
    ]
  }
]

// Old six-tier keys (pre-2026-08-18 Local/B2B split) → consolidated keys.
// clients.tier_key was migrated in the DB (migrate_2026-08-18_pricing-
// restructure.sql), but stale keys can still arrive from old links, cached
// dashboards, or Stripe metadata — resolve them instead of failing.
const LEGACY_KEY_MAP: Record<string, string> = {
  'local-care': 'care',
  'b2b-care': 'care',
  'local-seo': 'seo',
  'local-growth': 'growth',
  'b2b-momentum': 'growth',
  'b2b-growth': 'growth'
}

const BY_KEY: Record<string, TierInfo> = Object.fromEntries(CATALOG.map(t => [t.key, t]))

// DEPRECATED price IDs from the retired six-tier catalog. Existing Stripe
// subscriptions can still carry these prices, so the reverse lookup must keep
// resolving them — each maps to its consolidated tier. Don't delete; don't
// use for anything new.
const LEGACY_PRICE_ENV: Array<[string | undefined, string]> = [
  [process.env.STRIPE_PRICE_TIER_LOCAL_CARE, 'care'],
  [process.env.STRIPE_PRICE_TIER_B2B_CARE, 'care'],
  [process.env.STRIPE_PRICE_TIER_LOCAL_SEO, 'seo'],
  [process.env.STRIPE_PRICE_TIER_LOCAL_GROWTH, 'growth'],
  [process.env.STRIPE_PRICE_TIER_B2B_MOMENTUM, 'growth'],
  [process.env.STRIPE_PRICE_TIER_B2B_GROWTH, 'growth']
]

// Keyed by Stripe price ID for reverse lookup from a subscription item — same
// pattern as services.ts's serviceForPriceId. Only configured (non-'') prices
// are indexed, so an unset price can never accidentally match. Note a custom
// deal's subscription can contain price IDs this map has never heard of —
// callers must treat "null for one item" as normal, not an error (the tier
// item still resolves).
const BY_PRICE_ID: Record<string, TierInfo> = Object.fromEntries([
  ...LEGACY_PRICE_ENV.filter(([id]) => id).map(([id, key]) => [id as string, BY_KEY[key]] as const),
  // Current prices last so they win if an env var was ever reused.
  ...CATALOG.filter(t => t.stripePriceId).map(t => [t.stripePriceId, t] as const)
])

export function tierForKey(key: string | null | undefined): TierInfo | null {
  if (!key) return null
  return BY_KEY[key] ?? BY_KEY[LEGACY_KEY_MAP[key]] ?? null
}

// Old key → new key ('care'/'seo'/'growth'); current keys pass through.
// Returns null for a key that was never a tier.
export function resolveTierKey(key: string | null | undefined): string | null {
  return tierForKey(key)?.key ?? null
}

export function tierForPriceId(priceId: string | null | undefined): TierInfo | null {
  if (!priceId) return null
  return BY_PRICE_ID[priceId] ?? null
}

export function listTiers(): TierInfo[] {
  return CATALOG
}
