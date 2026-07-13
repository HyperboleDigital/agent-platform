import { supabase } from './supabase'
import { getClientById } from './clients'
import { notify } from './notify'

export type RequestStatus = 'open' | 'in_progress' | 'done' | 'declined'

export interface ChangeRequest {
  id: string
  clientId: string
  title: string
  description: string
  status: RequestStatus
  createdBy: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

interface Row {
  id: string
  client_id: string
  title: string
  description: string
  status: RequestStatus
  created_by: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

function fromRow(r: Row): ChangeRequest {
  return {
    id: r.id,
    clientId: r.client_id,
    title: r.title,
    description: r.description,
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at
  }
}

export async function listRequests(clientId: string): Promise<ChangeRequest[]> {
  const { data, error } = await supabase
    .from('change_requests')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
  if (error) { console.error('[change-requests] list error', error.message); return [] }
  return (data as Row[]).map(fromRow)
}

export interface ChangeRequestWithClient extends ChangeRequest {
  clientName: string
}

// Cross-client queue for the superadmin Overview page — open/in_progress
// requests only, newest first, with the client name joined in for display.
export async function listOpenRequests(): Promise<ChangeRequestWithClient[]> {
  const { data, error } = await supabase
    .from('change_requests')
    .select('*')
    .in('status', ['open', 'in_progress'])
    .order('created_at', { ascending: false })
  if (error) { console.error('[change-requests] list open error', error.message); return [] }

  const requests = (data as Row[]).map(fromRow)
  const clientIds = [...new Set(requests.map(r => r.clientId))]
  const { data: clients } = await supabase.from('clients').select('id, name').in('id', clientIds)
  const nameById = new Map((clients ?? []).map((c: { id: string; name: string }) => [c.id, c.name]))

  return requests.map(r => ({ ...r, clientName: nameById.get(r.clientId) ?? 'Unknown client' }))
}

export async function createRequest(clientId: string, title: string, description: string, createdBy: string | null): Promise<ChangeRequest> {
  const { data, error } = await supabase
    .from('change_requests')
    .insert({ client_id: clientId, title, description, created_by: createdBy })
    .select()
    .single()
  if (error) throw error
  const request = fromRow(data as Row)

  const client = await getClientById(clientId)
  await notify(clientId, 'request.created', {
    title: `New change request — ${client?.name ?? clientId}`,
    body: `${title}\n\n${description || '(no description)'}`
  })

  return request
}

const VALID_STATUSES: RequestStatus[] = ['open', 'in_progress', 'done', 'declined']

export async function updateRequestStatus(clientId: string, requestId: string, status: RequestStatus): Promise<ChangeRequest> {
  if (!VALID_STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`)
  const { data, error } = await supabase
    .from('change_requests')
    .update({
      status,
      updated_at: new Date().toISOString(),
      completed_at: status === 'done' ? new Date().toISOString() : null
    })
    .eq('client_id', clientId)
    .eq('id', requestId)
    .select()
    .single()
  if (error) throw error
  const request = fromRow(data as Row)

  await notify(clientId, 'request.status_changed', {
    title: `Request update — ${request.title}`,
    body: `Status changed to "${status}".`
  })

  return request
}
