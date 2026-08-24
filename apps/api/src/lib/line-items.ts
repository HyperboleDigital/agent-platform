import { supabase } from './supabase'

// Per-client custom line items — the mechanism behind "every client's deal is
// customized on a per-deal info sheet." A client's billing is a tier TEMPLATE
// (lib/tiers.ts) plus an arbitrary set of these: add, remove, re-price, or
// comp any line item for a specific client.
//
// HARD RULE: a line item is a billing and presentation concern ONLY. It never
// silently grants (or overrides) access to a feature — if a custom item is
// meant to give a client something, that access still goes through the
// existing comp path in entitlements (service_grants, source: 'comp'). There
// is deliberately NO fourth entitlement source; lib/entitlements.ts must
// never read this table.
//
// `included: true` = a deal sweetener: the item still renders on the info
// sheet (struck through / marked "included") but contributes $0 to billing
// and MRR. amount_cents keeps its real value so we can always see what we
// gave away.

export type LineItemCadence = 'monthly' | 'one_time'

export interface ClientLineItem {
  id: string
  clientId: string
  label: string
  description: string | null
  amountCents: number
  cadence: LineItemCadence
  included: boolean
  stripePriceId: string | null
  sortOrder: number
  createdAt: string
}

interface LineItemRow {
  id: string
  client_id: string
  label: string
  description: string | null
  amount_cents: number
  cadence: LineItemCadence
  included: boolean
  stripe_price_id: string | null
  sort_order: number
  created_at: string
}

function fromRow(row: LineItemRow): ClientLineItem {
  return {
    id: row.id,
    clientId: row.client_id,
    label: row.label,
    description: row.description,
    amountCents: row.amount_cents,
    cadence: row.cadence,
    included: row.included,
    stripePriceId: row.stripe_price_id,
    sortOrder: row.sort_order,
    createdAt: row.created_at
  }
}

export async function listLineItems(clientId: string): Promise<ClientLineItem[]> {
  const { data, error } = await supabase
    .from('client_line_items')
    .select('*')
    .eq('client_id', clientId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Failed to load line items: ${error.message}`)
  return ((data ?? []) as LineItemRow[]).map(fromRow)
}

export interface LineItemInput {
  label: string
  description?: string | null
  amountCents: number
  cadence: LineItemCadence
  included?: boolean
  sortOrder?: number
}

export async function createLineItem(clientId: string, input: LineItemInput): Promise<ClientLineItem> {
  const { data, error } = await supabase
    .from('client_line_items')
    .insert({
      client_id: clientId,
      label: input.label,
      description: input.description ?? null,
      amount_cents: input.amountCents,
      cadence: input.cadence,
      included: input.included ?? false,
      sort_order: input.sortOrder ?? 0
    })
    .select()
    .single()
  if (error) throw new Error(`Failed to create line item: ${error.message}`)
  return fromRow(data as LineItemRow)
}

export async function updateLineItem(clientId: string, itemId: string, input: Partial<LineItemInput>): Promise<ClientLineItem> {
  const patch: Partial<LineItemRow> = {}
  if (input.label !== undefined) patch.label = input.label
  if (input.description !== undefined) patch.description = input.description ?? null
  if (input.amountCents !== undefined) patch.amount_cents = input.amountCents
  if (input.cadence !== undefined) patch.cadence = input.cadence
  if (input.included !== undefined) patch.included = input.included
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder
  const { data, error } = await supabase
    .from('client_line_items')
    .update(patch)
    .eq('id', itemId)
    .eq('client_id', clientId) // guarded: never edit another client's item
    .select()
    .single()
  if (error) throw new Error(`Failed to update line item: ${error.message}`)
  return fromRow(data as LineItemRow)
}

export async function deleteLineItem(clientId: string, itemId: string): Promise<void> {
  const { error } = await supabase
    .from('client_line_items')
    .delete()
    .eq('id', itemId)
    .eq('client_id', clientId)
  if (error) throw new Error(`Failed to delete line item: ${error.message}`)
}

// THE one definition of what a set of line items adds to a monthly bill:
// monthly cadence, not comped. one_time items NEVER count toward a monthly
// figure. Both the MRR rollup (lib/overview.ts) and the info sheet derive
// from this — same numbers, one source, can't drift apart (the exact drift
// TODO.md flags for plan vs add-on math).
export function monthlyLineItemTotalCents(items: ClientLineItem[]): number {
  return items
    .filter(i => i.cadence === 'monthly' && !i.included)
    .reduce((sum, i) => sum + i.amountCents, 0)
}

// One-time items owed (not comped) — build fees, chatbot setup, etc. These are
// billed as invoice items / a one-off invoice, never subscription items.
export function oneTimeLineItemTotalCents(items: ClientLineItem[]): number {
  return items
    .filter(i => i.cadence === 'one_time' && !i.included)
    .reduce((sum, i) => sum + i.amountCents, 0)
}

// Batched monthly line-item revenue per client for the Overview MRR rollup —
// mirrors overview.ts's other batch helpers (one query for every client, not N).
export async function getMonthlyLineItemRevenueByClient(clientIds: string[]): Promise<Map<string, number>> {
  if (clientIds.length === 0) return new Map()
  const { data, error } = await supabase
    .from('client_line_items')
    .select('client_id, amount_cents, cadence, included')
    .in('client_id', clientIds)
  if (error) {
    console.error('[line-items] failed to load line items for MRR', error.message)
    return new Map()
  }
  const map = new Map<string, number>()
  for (const row of (data ?? []) as Pick<LineItemRow, 'client_id' | 'amount_cents' | 'cadence' | 'included'>[]) {
    if (row.cadence !== 'monthly' || row.included) continue
    map.set(row.client_id, (map.get(row.client_id) ?? 0) + row.amount_cents)
  }
  return map
}
