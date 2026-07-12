import { supabase } from '../lib/supabase'
import type { Lead, Channel } from '@agent-platform/shared'

interface LeadRow {
  id: string
  client_id: string
  name: string | null
  email: string
  intent: string
  summary: string
  channel: string
  created_at: string
}

function fromRow(row: LeadRow): Lead {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name ?? undefined,
    email: row.email,
    intent: row.intent,
    summary: row.summary,
    channel: row.channel as Channel,
    createdAt: row.created_at
  }
}

export async function logLead(lead: Omit<Lead, 'id' | 'createdAt' | 'channel'>): Promise<void> {
  await supabase.from('leads').insert({
    client_id: lead.clientId,
    name: lead.name,
    email: lead.email,
    intent: lead.intent,
    summary: lead.summary
  })
}

export async function getLeads(clientId: string): Promise<Lead[]> {
  const { data } = await supabase
    .from('leads')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
  return ((data ?? []) as LeadRow[]).map(fromRow)
}
