import { supabase } from './supabase'
import type { Client } from '@agent-platform/shared'


export async function getClientById(id: string): Promise<Client | null> {
  console.log('[clients] looking up id:', id)
  const { data, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', id)
    .single()
  console.log('[clients] data:', data)
  console.log('[clients] error:', error)
  if (error) return null
  return data as Client
}


export async function getAllClients(): Promise<Client[]> {
  const { data } = await supabase.from('clients').select('*').order('created_at', { ascending: false })
  return (data ?? []) as Client[]
}

export async function upsertClient(client: Partial<Client>): Promise<Client> {
  const { data, error } = await supabase
    .from('clients')
    .upsert(client)
    .select()
    .single()
  if (error) throw error
  return data as Client
}


