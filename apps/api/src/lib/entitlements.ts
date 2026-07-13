import { supabase } from './supabase'
import { getSubscription, isActive, planForPriceId } from './billing'
import { listServices, serviceForPriceId, type ServiceKey, type ServiceInfo } from './services'

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

export interface ServiceEntitlement {
  entitled: boolean
  source: 'addon' | 'comp' | null
  status: ServiceInfo['status']
}

export interface Entitlements {
  active: boolean // base subscription active (paid/trialing/past_due or comped)
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
  const [sub, itemsRes, grantsRes] = await Promise.all([
    getSubscription(clientId),
    supabase.from('subscription_items').select('stripe_price_id').eq('client_id', clientId),
    supabase.from('service_grants').select('service_key').eq('client_id', clientId).is('revoked_at', null)
  ])

  if (itemsRes.error) console.error('[entitlements] subscription_items error', itemsRes.error.message)
  if (grantsRes.error) console.error('[entitlements] service_grants error', grantsRes.error.message)

  const baseActive = isActive(sub)
  const plan = sub ? planForPriceId(sub.stripePriceId) : null

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

  const services = {} as Record<ServiceKey, ServiceEntitlement>
  for (const svc of listServices()) {
    let source: 'addon' | 'comp' | null = null
    if (addonKeys.has(svc.key)) source = 'addon'
    else if (grantedKeys.has(svc.key)) source = 'comp'
    services[svc.key] = { entitled: source !== null, source, status: svc.status }
  }

  return { active: baseActive, planKey: plan?.key ?? null, services }
}

// Route guard helper: true when the client is entitled to the given service.
export async function isEntitled(clientId: string, key: ServiceKey): Promise<boolean> {
  const ent = await getEntitlements(clientId)
  return ent.services[key]?.entitled ?? false
}
