import { supabase } from '../lib/supabase'
import type { Lead } from '@agent-platform/shared'

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
  return (data ?? []) as Lead[]
}
