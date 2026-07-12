import { supabase } from './supabase'
import type { Client } from '@agent-platform/shared'

interface ClientRow {
  id: string
  name: string
  domain: string
  industry: string
  active: boolean
  agent_config: Client['agentConfig']
  created_at: string
  clerk_org_id: string | null
}

function fromRow(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    industry: row.industry,
    active: row.active,
    agentConfig: row.agent_config ?? ({} as Client['agentConfig']),
    createdAt: row.created_at,
    clerkOrgId: row.clerk_org_id ?? null
  }
}

function toRow(client: Partial<Client>): Partial<ClientRow> {
  const row: Partial<ClientRow> = {}
  if (client.id !== undefined) row.id = client.id
  if (client.name !== undefined) row.name = client.name
  if (client.domain !== undefined) row.domain = client.domain
  if (client.industry !== undefined) row.industry = client.industry
  if (client.active !== undefined) row.active = client.active
  if (client.agentConfig !== undefined) row.agent_config = client.agentConfig
  if (client.clerkOrgId !== undefined) row.clerk_org_id = client.clerkOrgId
  return row
}

export async function getClientByOrgId(clerkOrgId: string): Promise<Client | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('clerk_org_id', clerkOrgId)
    .single()
  if (error) return null
  return fromRow(data as ClientRow)
}

export async function getClientById(id: string): Promise<Client | null> {
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .single()
  if (error) return null
  return fromRow(data as ClientRow)
}

export async function getAllClients(): Promise<Client[]> {
  const { data } = await supabase.from('clients').select('*').order('created_at', { ascending: false })
  return ((data ?? []) as ClientRow[]).map(fromRow)
}

// Partial update if `id` is provided (Supabase .upsert() replaces the whole row
// on conflict, which would null out any omitted columns — not what a "save this
// one field" call from the dashboard wants). Falls back to insert otherwise.
export async function upsertClient(client: Partial<Client>): Promise<Client> {
  const row = toRow(client)

  if (client.id) {
    const { data, error } = await supabase
      .from('clients')
      .update(row)
      .eq('id', client.id)
      .select()
      .single()
    if (!error) return fromRow(data as ClientRow)
    if (error.code !== 'PGRST116') throw error // PGRST116 = no matching row, fall through to insert
  }

  const { data, error } = await supabase.from('clients').insert(row).select().single()
  if (error) throw error
  return fromRow(data as ClientRow)
}
