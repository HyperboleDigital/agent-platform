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
//     being on a pricing-sheet tier that includes it (see lib/tiers.ts). Has no
//     Stripe price, so both the checkout and add-on paths refuse it.

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
    // Included in the Growth tiers; otherwise an add-on whose standalone price
    // is still TBD (STRIPE_PRICE_CHAT unset → coming_soon, i.e. "ask us"). Set
    // the env price + flip status to 'available' to sell it standalone.
    priceId: process.env.STRIPE_PRICE_CHAT ?? '',
    name: 'AI Chat Assistant',
    monthlyPriceCents: 0,
    description:
      'A 24/7 AI assistant on your website that answers customer questions, captures leads, and books calls. Included on Growth plans; available as an add-on.',
    status: process.env.STRIPE_PRICE_CHAT ? 'available' : 'coming_soon'
  },
  {
    key: 'seo',
    priceId: process.env.STRIPE_PRICE_SEO ?? '',
    name: 'SEO & AI Visibility',
    monthlyPriceCents: 49900,
    description:
      'Keyword rankings from Google Search Console, technical site audits, and tracking of how your brand shows up in ChatGPT and other AI search.',
    status: 'available'
  },
  {
    key: 'content',
    priceId: process.env.STRIPE_PRICE_CONTENT ?? '',
    name: 'Content Engine',
    monthlyPriceCents: 79900,
    description:
      'AI-drafted, keyword-targeted blog posts grounded in your business, reviewed by you and published straight to your site.',
    status: 'available'
  },
  {
    key: 'local',
    priceId: '', // tier-granted only — never sold standalone
    name: 'Local Presence',
    monthlyPriceCents: 0,
    description:
      'Google Business Profile activity and directory citations with NAP consistency tracking across 40+ listings.',
    status: 'tier_only'
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
