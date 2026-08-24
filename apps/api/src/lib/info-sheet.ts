import { getClientById } from './clients'
import { getEntitlements } from './entitlements'
import { listServices, type ServiceKey } from './services'
import { tierForKey, type TierInfo } from './tiers'
import { listLineItems, monthlyLineItemTotalCents, oneTimeLineItemTotalCents, type ClientLineItem } from './line-items'

// The per-client info sheet: a client's full commercial picture in one place —
// tier + price, add-ons, every custom line item, one-time fees, and the
// totals. This is the artifact behind the superadmin Info Sheet view, i.e.
// what a deal actually says, whether or not Stripe is billing it yet.
//
// All the summing rules live in lib/line-items.ts, shared with the Overview
// MRR rollup — one source for the math, so the sheet and the revenue numbers
// can't drift apart. (The sheet's monthly total and MRR can still legitimately
// differ for one reason only: MRR counts nothing until billing is active.)

export interface InfoSheetAddon {
  key: ServiceKey
  name: string
  description: string
  monthlyPriceCents: number
  comped: boolean // granted, not paid — renders as included, contributes $0
}

export interface InfoSheet {
  clientName: string
  clientSlug: string
  hosting: 'us' | 'client'
  tier: Pick<TierInfo, 'key' | 'name' | 'monthlyPriceCents' | 'features'> | null
  addons: InfoSheetAddon[]
  lineItems: ClientLineItem[]
  monthlyTotalCents: number
  oneTimeTotalCents: number
}

export async function getInfoSheet(clientId: string): Promise<InfoSheet> {
  const client = await getClientById(clientId)
  if (!client) throw new Error('Client not found')

  const [entitlements, lineItems] = await Promise.all([
    getEntitlements(clientId),
    listLineItems(clientId)
  ])

  const tier = tierForKey(client.tierKey)

  // Add-ons the client actually has, beyond the tier: paid Stripe add-ons and
  // comped grants. Tier-sourced services aren't repeated here — they're part
  // of the tier's own feature list.
  const addons: InfoSheetAddon[] = listServices()
    .filter(svc => {
      const src = entitlements.services[svc.key]?.source
      return src === 'addon' || src === 'comp'
    })
    .map(svc => ({
      key: svc.key,
      name: svc.name,
      description: svc.description,
      monthlyPriceCents: svc.monthlyPriceCents,
      comped: entitlements.services[svc.key]?.source === 'comp'
    }))

  const addonMonthlyCents = addons.filter(a => !a.comped).reduce((sum, a) => sum + a.monthlyPriceCents, 0)

  return {
    clientName: client.name,
    clientSlug: client.slug,
    hosting: client.hosting,
    tier: tier ? { key: tier.key, name: tier.name, monthlyPriceCents: tier.monthlyPriceCents, features: tier.features } : null,
    addons,
    lineItems,
    monthlyTotalCents: (tier?.monthlyPriceCents ?? 0) + addonMonthlyCents + monthlyLineItemTotalCents(lineItems),
    oneTimeTotalCents: oneTimeLineItemTotalCents(lineItems)
  }
}
