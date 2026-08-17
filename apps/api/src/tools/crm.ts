import { supabase } from '../lib/supabase'
import type { Lead, Channel, LeadStatus } from '@agent-platform/shared'

interface LeadRow {
  id: string
  client_id: string
  name: string | null
  email: string
  intent: string
  summary: string
  channel: string
  status: LeadStatus
  created_at: string
  company: string | null
  phone: string | null
  division: string | null
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
    status: row.status,
    createdAt: row.created_at,
    company: row.company ?? undefined,
    phone: row.phone ?? undefined,
    division: row.division ?? undefined
  }
}

export async function logLead(
  lead: Omit<Lead, 'id' | 'createdAt' | 'channel' | 'status'> & { sessionId?: string }
): Promise<void> {
  await supabase.from('leads').insert({
    client_id: lead.clientId,
    name: lead.name,
    email: lead.email,
    intent: lead.intent,
    summary: lead.summary,
    company: lead.company,
    phone: lead.phone,
    division: lead.division,
    // Links the lead to the chat session that produced it, so the chat_sessions
    // view can mark that conversation's outcome as 'lead'. Null for contact-form
    // submissions (no session id) — those still record the lead, just unlinked.
    session_id: lead.sessionId ?? null
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

const VALID_STATUSES: LeadStatus[] = ['new', 'followed_up']

export async function updateLeadStatus(clientId: string, leadId: string, status: LeadStatus): Promise<Lead> {
  if (!VALID_STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`)
  const { data, error } = await supabase
    .from('leads')
    .update({ status })
    .eq('client_id', clientId)
    .eq('id', leadId)
    .select()
    .single()
  if (error) throw error
  return fromRow(data as LeadRow)
}

// Superadmin-only (see routes/clients.ts) — clients don't get a delete
// control yet, only the followed-up toggle above.
export async function deleteLead(clientId: string, leadId: string): Promise<void> {
  const { error } = await supabase.from('leads').delete().eq('client_id', clientId).eq('id', leadId)
  if (error) throw error
}
