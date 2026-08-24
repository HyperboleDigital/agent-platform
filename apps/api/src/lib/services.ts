// Add-on service catalog — the modular services a client can toggle on top of
// their base plan (SEO, content, future agents). Mirrors the PLANS pattern in
// lib/billing.ts: keyed by Stripe price ID (from env) so adding a service,
// repricing, or launching a new agent is a config change here, not a schema
// migration. Entitlements resolve against this catalog — see lib/entitlements.ts.
//
// `status` controls dashboard rendering:
//   'available'   — purchasable now; locked section shows an "Add to plan" CTA.
//   'coming_soon' — visible but not purchasable; shows a "Coming soon" badge.
//     A coming_soon service still appears in the marketplace so clients can see
//     what's on the roadmap, but has no (or a placeholder) price ID.
//   'tier_only'   — not separately purchasable at any price; granted only by
//     being on a pricing-sheet tier that includes it (see lib/tiers.ts). The
//     checkout and add-on paths both refuse it, and the marketplace hides it.
//     A tier_only service may still carry a `priceId`: legacy subscriptions
//     from the retired à-la-carte era need it to keep resolving through
//     serviceForPriceId. It just can't be SOLD at that price anymore.

export type ServiceKey = 'seo' | 'content' | 'reviews' | 'social' | 'local' | 'chat' | 'ads'

// Paid Ads (Google PPC) management. Its fee is "greater of a flat floor or % of
// spend" (see lib/billing.ts computeAdsFee). The recurring FLOOR bills via this
// single Stripe price; the % overage rides on as a monthly invoice item.
const ADS_PRICE = process.env.STRIPE_PRICE_ADS ?? ''

// The recurring floor price ('' when unset → not purchasable yet, same
// convention as every other price).
export function adsFloorPriceId(): string {
  return ADS_PRICE
}

export interface ServiceInfo {
  key: ServiceKey
  priceId: string // '' when coming_soon and no Stripe price exists yet
  name: string
  monthlyPriceCents: number
  description: string
  status: 'available' | 'coming_soon' | 'tier_only'
}

const CATALOG: ServiceInfo[] = [
  {
    key: 'chat',
    // Included in Growth. Never sold standalone as a monthly add-on — the
    // chatbot's own commercial line is the ONE-TIME Chatbot Setup fee ($2,500,
    // frequently waived on annual), which is a per-deal line item, not a
    // recurring service price. Previously rendered as 'coming_soon' whenever
    // STRIPE_PRICE_CHAT was unset, which told clients a shipped, live product
    // was still on the roadmap.
    priceId: process.env.STRIPE_PRICE_CHAT ?? '',
    name: 'AI Chat Assistant',
    monthlyPriceCents: 0,
    description:
      'A 24/7 AI assistant on your website that answers customer questions, captures leads, and books calls. Included on the Growth plan.',
    status: 'tier_only'
  },
  {
    // seo/content carry $499/$799 prices from the retired pre-tier à-la-carte
    // model. Those amounts are NOT on the 2026-08-18 pricing sheet — SEO is a
    // $1,200/mo TIER and content comes with Growth at $2,500. Leaving them
    // 'available' put a 60%-off, off-sheet price one click away in the
    // marketplace and on the locked-section screen. They're tier-granted only
    // now; priceId is kept purely so any legacy subscription item still
    // resolves via serviceForPriceId.
    key: 'seo',
    priceId: process.env.STRIPE_PRICE_SEO ?? '',
    name: 'SEO & AI Visibility',
    monthlyPriceCents: 49900,
    description:
      'Keyword rankings from Google Search Console, technical site audits, and tracking of how your brand shows up across the major AI assistants — ChatGPT, Claude, Gemini and the rest — when customers ask them for a business like yours.',
    status: 'tier_only'
  },
  {
    key: 'content',
    priceId: process.env.STRIPE_PRICE_CONTENT ?? '',
    name: 'Content Engine',
    monthlyPriceCents: 79900,
    description:
      'AI-drafted, keyword-targeted blog posts grounded in your business, reviewed by you and published straight to your site.',
    status: 'tier_only'
  },
  {
    // A real purchasable add-on since the 2026-08-18 pricing restructure (was
    // tier_only under the old six-tier catalog — no tier grants it anymore).
    // Offered only to clients where local search matters.
    key: 'local',
    priceId: process.env.STRIPE_PRICE_LOCAL ?? '',
    name: 'Local Presence',
    monthlyPriceCents: 25000,
    description:
      'Google Business Profile posts, directory citations with NAP consistency across 40+ listings, and map-pack rank tracking.',
    status: process.env.STRIPE_PRICE_LOCAL ? 'available' : 'coming_soon'
  },
  {
    key: 'ads',
    priceId: ADS_PRICE,
    name: 'Paid Ads Management',
    monthlyPriceCents: 0, // "greater of floor or % of spend" — see billing.computeAdsFee
    description:
      'We plan, launch, and manage your Google Ads — keyword targeting, ad copy, and ongoing optimization. You pay Google directly for the ad spend; our fee is the greater of a flat monthly floor or a percentage of that spend. Live spend, clicks, and cost-per-lead show up right here.',
    status: ADS_PRICE ? 'available' : 'coming_soon'
  },
  {
    key: 'reviews',
    priceId: process.env.STRIPE_PRICE_REVIEWS ?? '',
    name: 'Reviews & Reputation',
    monthlyPriceCents: 0,
    description:
      'Monitor and respond to reviews across Google and other platforms, with AI-assisted replies. Coming soon.',
    status: 'coming_soon'
  },
  {
    key: 'social',
    priceId: process.env.STRIPE_PRICE_SOCIAL ?? '',
    name: 'Social Autopilot',
    monthlyPriceCents: 0,
    description:
      'Turn your blog posts and updates into scheduled social content across your channels. Coming soon.',
    status: 'coming_soon'
  }
]

// Keyed by price ID for reverse lookup from Stripe subscription items. Only
// non-empty price IDs are indexed (coming_soon services with no price can't be
// on a subscription anyway).
const BY_PRICE_ID: Record<string, ServiceInfo> = Object.fromEntries(
  CATALOG.filter(s => s.priceId).map(s => [s.priceId, s])
)

const BY_KEY: Record<string, ServiceInfo> = Object.fromEntries(CATALOG.map(s => [s.key, s]))

export function serviceForPriceId(priceId: string | null | undefined): ServiceInfo | null {
  if (!priceId) return null
  return BY_PRICE_ID[priceId] ?? null
}

export function serviceForKey(key: string): ServiceInfo | null {
  return BY_KEY[key] ?? null
}

export function listServices(): ServiceInfo[] {
  return CATALOG
}

// True when the given price ID belongs to an add-on service (as opposed to a
// base plan). Used by the subscription sync to classify line items.
export function isServicePriceId(priceId: string | null | undefined): boolean {
  return !!priceId && priceId in BY_PRICE_ID
}
