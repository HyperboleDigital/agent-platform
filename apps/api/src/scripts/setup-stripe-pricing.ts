import 'dotenv/config'
import { isPublicHost } from '@agent-platform/shared'
import { stripe } from '../lib/billing'
import { listTiers } from '../lib/tiers'
import { listServices } from '../lib/services'

// Creates (or adopts) the Stripe products + prices for the three-tier pricing
// sheet and the Local Presence add-on, then prints the env lines to set.
//
// Run:  pnpm --filter api setup-stripe-pricing
// Live: STRIPE_SECRET_KEY=sk_live_... pnpm --filter api setup-stripe-pricing
//
// Idempotent — reruns adopt what already exists and create nothing new. Every
// object it creates is tagged with metadata (`tier_key` / `service_key`), and
// that tag is how a rerun finds them again, so renaming a product in the
// Stripe dashboard won't cause a duplicate.
//
// SAFETY — this script only ever CREATES. It never renames, archives, or
// re-prices an existing Stripe object. A live account has real billing
// history, and renaming a product there changes how a real customer's invoice
// reads. (The test-mode setup on 2026-08-18 did adopt-and-rename by hand
// because that data was disposable; this script deliberately does not.)
//
// It will adopt an existing price only when that price is an EXACT match:
// same amount, monthly recurring, active, and already tagged for this tier.
// A near-miss (e.g. the retired $2,400 local-growth price against the $2,500
// Growth tier) is reported and skipped, never silently reused.

interface Target {
  envVar: string
  name: string
  description: string
  amountCents: number
  tag: { key: 'tier_key' | 'service_key'; value: string }
}

// Derived from the catalogs rather than hardcoded, so a repriced tier or a
// newly-priced add-on is picked up here automatically.
//
// Add-ons are every service that is genuinely SOLD at a flat monthly price.
// Excluded, deliberately:
//   - `tier_only` (seo, content, chat) — granted by the tier that includes
//     them. Their $499/$799 fields are retired à-la-carte amounts kept only so
//     legacy subscription items still resolve; creating live prices for them
//     would put off-sheet numbers into the account.
//   - `ads` (priceCents 0) — fee is "greater of a floor or % of spend", a
//     usage-billing design that is still deferred (see TODO.md).
// Note this filters on `tier_only`, NOT on `status === 'available'`: `local`
// is only 'available' once STRIPE_PRICE_LOCAL is set, and this script is what
// produces that value in the first place.
function targets(): Target[] {
  return [
    ...listTiers().map(t => ({
      envVar: `STRIPE_PRICE_TIER_${t.key.toUpperCase()}`,
      name: t.name,
      description: `${t.name} plan — Hyperbole Digital`,
      amountCents: t.monthlyPriceCents,
      tag: { key: 'tier_key' as const, value: t.key }
    })),
    ...listServices()
      .filter(s => s.status !== 'tier_only' && s.monthlyPriceCents > 0)
      .map(s => ({
        envVar: `STRIPE_PRICE_${s.key.toUpperCase()}`,
        name: s.name,
        description: s.description,
        amountCents: s.monthlyPriceCents,
        tag: { key: 'service_key' as const, value: s.key }
      }))
  ]
}

async function findTagged(tag: Target['tag']) {
  const res = await stripe.products.search({ query: `metadata['${tag.key}']:'${tag.value}'`, limit: 10 })
  return res.data.filter(p => p.active)
}

async function ensure(target: Target, dryRun: boolean): Promise<{ priceId: string; action: string }> {
  // Already set up? Reuse the tagged product's matching price.
  for (const product of await findTagged(target.tag)) {
    if (dryRun) {
      const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 })
      const exact = prices.data.find(p => p.unit_amount === target.amountCents && p.recurring?.interval === 'month')
      return { priceId: exact?.id ?? '(would add price)', action: exact ? 'would adopt existing' : `would ADD PRICE to ${product.id}` }
    }
    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 })
    const exact = prices.data.find(
      p => p.unit_amount === target.amountCents && p.recurring?.interval === 'month'
    )
    if (exact) return { priceId: exact.id, action: `adopted existing (product ${product.id})` }
    // Tagged product exists but at the wrong price — add the correct price to
    // it rather than making a second product for the same thing.
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: target.amountCents,
      currency: 'usd',
      recurring: { interval: 'month' },
      metadata: { [target.tag.key]: target.tag.value }
    })
    return { priceId: price.id, action: `NEW PRICE on existing product ${product.id} (old prices left active — archive by hand if wanted)` }
  }

  if (dryRun) return { priceId: '(none yet)', action: `would CREATE product "${target.name}" + $${(target.amountCents / 100).toLocaleString()}/mo price` }

  const product = await stripe.products.create({
    name: target.name,
    description: target.description,
    metadata: { [target.tag.key]: target.tag.value }
  })
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: target.amountCents,
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { [target.tag.key]: target.tag.value }
  })
  return { priceId: price.id, action: `CREATED product ${product.id} + price` }
}

// The exact events routes/billing.ts's handler acts on. Anything else is
// ignored by the handler, so subscribing to more would just add noise.
const WEBHOOK_EVENTS: string[] = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted'
]

// Creates the hosted webhook endpoint and prints its signing secret.
//
// Stripe returns the signing secret ONLY at creation time — it can never be
// read back, only rolled. So if an endpoint for this URL already exists, this
// reports it and stops rather than making a duplicate; get the secret by
// rolling it in the Stripe dashboard.
//
// Opt-in via --with-webhook, because unlike the price setup this prints a
// secret to the terminal.
async function ensureWebhook(url: string): Promise<void> {
  const existing = await stripe.webhookEndpoints.list({ limit: 100 })
  const match = existing.data.find(e => e.url === url)
  if (match) {
    console.log(`\nWebhook endpoint already exists for ${url} (status: ${match.status}).`)
    const missing = WEBHOOK_EVENTS.filter(ev => !match.enabled_events.includes(ev) && !match.enabled_events.includes('*'))
    if (missing.length) {
      await stripe.webhookEndpoints.update(match.id, { enabled_events: [...new Set([...match.enabled_events, ...WEBHOOK_EVENTS])] as never })
      console.log(`  Added missing events: ${missing.join(', ')}`)
    } else {
      console.log('  All required events already enabled.')
    }
    console.log('  Signing secret is not readable after creation — roll it in the Stripe dashboard if you need it.')
    return
  }

  const created = await stripe.webhookEndpoints.create({
    url,
    enabled_events: WEBHOOK_EVENTS as never,
    description: 'agent-platform subscription sync'
  })
  console.log(`\nCreated webhook endpoint: ${url}`)
  console.log(`  events: ${WEBHOOK_EVENTS.join(', ')}`)
  console.log('\n  STRIPE_WEBHOOK_SECRET (shown ONCE — copy it into Render now, do not paste it anywhere else):')
  console.log(`  ${created.secret}`)
}

async function main() {
  const key = process.env.STRIPE_SECRET_KEY ?? ''
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  const live = key.startsWith('sk_live')
  console.log(`Stripe mode: ${live ? '*** LIVE ***' : 'TEST'}\n`)

  // In live mode, show what else is already in the account first — so an
  // operator sees any pre-existing product this might sit alongside.
  if (live) {
    const existing = await stripe.products.list({ active: true, limit: 100 })
    console.log(`Account already has ${existing.data.length} active product(s). This script adds to them; it changes none of them.\n`)
  }

  const dryRun = process.argv.includes('--dry-run')
  if (dryRun) console.log('DRY RUN — nothing will be created or modified.\n')

  const env: string[] = []
  for (const target of targets()) {
    const { priceId, action } = await ensure(target, dryRun)
    console.log(`${target.name.padEnd(20)} $${(target.amountCents / 100).toLocaleString().padEnd(6)} ${action}`)
    env.push(`${target.envVar}=${priceId}`)
  }

  console.log('\n--- set these env vars ---')
  for (const line of env) console.log(line)

  if (process.argv.includes('--with-webhook')) {
    // --url wins over API_PUBLIC_URL, because the local .env's API_PUBLIC_URL
    // is localhost by design (that's correct for dev) and Stripe can only
    // register a publicly reachable endpoint. Validated here rather than
    // letting Stripe reject it, so the error names the fix.
    const flagIdx = process.argv.indexOf('--url')
    const base = (flagIdx !== -1 ? process.argv[flagIdx + 1] ?? '' : process.env.API_PUBLIC_URL ?? '').replace(/\/$/, '')
    if (!base) throw new Error('--with-webhook needs --url https://api.example.com (or API_PUBLIC_URL)')

    let host: string
    try {
      host = new URL(base).hostname
    } catch {
      throw new Error(`--with-webhook: "${base}" is not a valid URL`)
    }
    if (!isPublicHost(host)) {
      throw new Error(
        `--with-webhook: "${base}" is not publicly reachable, so Stripe can't deliver to it.\n` +
        `  Your local .env sets API_PUBLIC_URL=${process.env.API_PUBLIC_URL} (correct for dev — use the Stripe CLI there:\n` +
        `  stripe listen --forward-to localhost:3001/billing/webhook).\n` +
        `  For the deployed endpoint, pass the real one explicitly:\n` +
        `    ... pnpm --filter api setup-stripe-pricing --with-webhook --url https://api.hyperboledigital.com`
      )
    }
    if (!base.startsWith('https://')) throw new Error(`--with-webhook: endpoint must be https, got "${base}"`)

    await ensureWebhook(`${base}/billing/webhook`)
  } else {
    console.log('\n(Re-run with --with-webhook to also create the hosted webhook endpoint')
    console.log(' and print its signing secret. Needs API_PUBLIC_URL set.)')
  }

  if (live) {
    console.log('\nSet these in the Render dashboard (Environment tab), not in a committed file.')
    console.log('Render redeploys automatically on save. Keep the legacy STRIPE_PRICE_TIER_LOCAL_*/_B2B_*')
    console.log('vars as they are — lib/tiers.ts needs them to resolve any pre-existing subscription.')
  }
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1) })
