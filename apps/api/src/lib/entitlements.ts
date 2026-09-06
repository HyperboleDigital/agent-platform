import { supabase } from './supabase'
import { getSubscription, isActive, planForSubscription } from './billing'
import { listServices, serviceForPriceId, type ServiceKey, type ServiceInfo } from './services'
import { getClientById } from './clients'
import { tierForKey } from './tiers'

// Resolves what a client is actually entitled to, from three sources:
//   1. Base plan  — the active subscription's plan (lib/billing.ts).
//   2. Add-ons    — subscription_items whose price maps to a SERVICE, but only
//                   while the base subscription is active (a cancelled base sub
//                   revokes everything, since the whole Stripe subscription is
//                   gone).
//   3. Comps      — unrevoked service_grants (superadmin grants, no payment).
//
// This is the single source of truth for both API route guards (assertEntitled)
// and the dashboard's locked-section rendering. Never trust the client.
//
// There is deliberately NO fourth source: per-client custom line items
// (client_line_items, lib/line-items.ts) are billing/presentation only and
// must never be read here. If a custom deal grants access to something, that
// grant goes through the comp path above.

export interface ServiceEntitlement {
  entitled: boolean
  source: 'addon' | 'comp' | 'tier' | null
  status: ServiceInfo['status']
}

export interface Entitlements {
  active: boolean // base subscription active (paid/trialing/past_due or comped)
  // The plan of whatever subscription row exists — INCLUDING a canceled one.
  // This is not "the plan they're currently on": check `active` before showing
  // it to anyone. Rendering it unconditionally is how a cancelled client ended
  // up seeing their old plan's name and price on the dashboard home.
  planKey: string | null
  services: Record<ServiceKey, ServiceEntitlement>
}

interface ItemRow {
  stripe_price_id: string
}

interface GrantRow {
  service_key: string
}

export async function getEntitlements(clientId: string): Promise<Entitlements> {
  const [sub, itemsRes, grantsRes, client] = await Promise.all([
    getSubscription(clientId),
    supabase.from('subscription_items').select('stripe_price_id').eq('client_id', clientId),
    supabase.from('service_grants').select('service_key').eq('client_id', clientId).is('revoked_at', null),
    getClientById(clientId)
  ])

  if (itemsRes.error) console.error('[entitlements] subscription_items error', itemsRes.error.message)
  if (grantsRes.error) console.error('[entitlements] service_grants error', grantsRes.error.message)

  const baseActive = isActive(sub)
  const plan = sub ? planForSubscription(sub.stripePriceId, sub.tierKey) : null

  // Add-on service keys purchased via Stripe — only count while the base
  // subscription is active.
  const addonKeys = new Set<string>()
  if (baseActive) {
    for (const row of (itemsRes.data ?? []) as ItemRow[]) {
      const svc = serviceForPriceId(row.stripe_price_id)
      if (svc) addonKeys.add(svc.key)
    }
  }

  const grantedKeys = new Set<string>((grantsRes.data ?? []).map((g: GrantRow) => g.service_key))

  // Third entitlement source: the finalized pricing-sheet tier a client is
  // assigned to (clients.tier_key — see lib/tiers.ts). No Stripe subscription
  // required, since these tiers aren't wired to Stripe yet — a tier grants its
  // included services outright, independent of `baseActive`.
  const tier = tierForKey(client?.tierKey)
  const tierKeys = new Set<string>(tier?.includes ?? [])

  const services = {} as Record<ServiceKey, ServiceEntitlement>
  for (const svc of listServices()) {
    let source: 'addon' | 'comp' | 'tier' | null = null
    if (addonKeys.has(svc.key)) source = 'addon'
    else if (grantedKeys.has(svc.key)) source = 'comp'
    else if (tierKeys.has(svc.key)) source = 'tier'
    services[svc.key] = { entitled: source !== null, source, status: svc.status }
  }

  return { active: baseActive, planKey: plan?.key ?? null, services }
}

// Route guard helper: true when the client is entitled to the given service.
export async function isEntitled(clientId: string, key: ServiceKey): Promise<boolean> {
  const ent = await getEntitlements(clientId)
  return ent.services[key]?.entitled ?? false
}
