import { supabase } from './supabase'
import { getClientById } from './clients'
import { notify, sendGuardedEmail } from './notify'
import { getDisplayNames, getUserEmail } from './users'
import { listAttachments, ATTACHMENT_BUCKET } from './attachments'

export type RequestStatus = 'open' | 'in_progress' | 'done' | 'declined' | 'cancelled'

// Who originated the request: a client ask, or a platform-generated SEO fix
// (seo-fixes.ts). SEO fixes carry fix_meta so the fix_verify job can confirm
// them against the next crawl — see migrate_2026-08-25b_seo-fix-tracking.sql.
export type RequestSource = 'client' | 'seo_fix'

export interface FixMeta {
  // Crawl check keys this fix addresses (empty = not crawl-verifiable).
  checkKeys: string[]
  // The page URLs the fix targets.
  urls: string[]
}

export interface ChangeRequest {
  id: string
  clientId: string
  title: string
  description: string
  status: RequestStatus
  createdBy: string | null
  cancelReason: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  source: RequestSource
  fixMeta: FixMeta | null
  verifiedAt: string | null
  regressedAt: string | null
}

interface Row {
  id: string
  client_id: string
  title: string
  description: string
  status: RequestStatus
  created_by: string | null
  cancel_reason: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
  // Optional pre-migration: absent until migrate_2026-08-25b runs.
  source?: RequestSource | null
  fix_meta?: FixMeta | null
  verified_at?: string | null
  regressed_at?: string | null
}

function fromRow(r: Row): ChangeRequest {
  return {
    id: r.id,
    clientId: r.client_id,
    title: r.title,
    description: r.description,
    status: r.status,
    createdBy: r.created_by,
    cancelReason: r.cancel_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
    source: r.source ?? 'client',
    fixMeta: r.fix_meta ?? null,
    verifiedAt: r.verified_at ?? null,
    regressedAt: r.regressed_at ?? null
  }
}

export interface RequestEvent {
  id: string
  requestId: string
  fromStatus: RequestStatus | null
  toStatus: RequestStatus
  changedBy: string | null
  note: string | null
  createdAt: string
}

interface EventRow {
  id: string
  request_id: string
  from_status: RequestStatus | null
  to_status: RequestStatus
  changed_by: string | null
  note: string | null
  created_at: string
}

function eventFromRow(r: EventRow): RequestEvent {
  return {
    id: r.id,
    requestId: r.request_id,
    fromStatus: r.from_status,
    toStatus: r.to_status,
    changedBy: r.changed_by,
    note: r.note,
    createdAt: r.created_at
  }
}

export interface RequestComment {
  id: string
  requestId: string
  authorId: string
  authorName: string
  isSuperadmin: boolean
  body: string
  mentions: string[]
  createdAt: string
}

interface CommentRow {
  id: string
  request_id: string
  author_id: string
  is_superadmin: boolean
  body: string
  mentions: string[] | null
  created_at: string
}

function commentFromRow(r: CommentRow, authorName: string): RequestComment {
  return {
    id: r.id,
    requestId: r.request_id,
    authorId: r.author_id,
    authorName,
    isSuperadmin: r.is_superadmin,
    body: r.body,
    mentions: r.mentions ?? [],
    createdAt: r.created_at
  }
}

async function recordEvent(requestId: string, fromStatus: RequestStatus | null, toStatus: RequestStatus, changedBy: string | null, note?: string): Promise<void> {
  const { error } = await supabase.from('change_request_events').insert({
    request_id: requestId, from_status: fromStatus, to_status: toStatus, changed_by: changedBy, note: note ?? null
  })
  if (error) console.error('[change-requests] failed to record event', error.message)
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

export async function createRequest(
  clientId: string, title: string, description: string, createdBy: string | null,
  opts: { source?: RequestSource; fixMeta?: FixMeta } = {}
): Promise<ChangeRequest> {
  const { data, error } = await supabase
    .from('change_requests')
    .insert({
      client_id: clientId, title, description, created_by: createdBy,
      ...(opts.source ? { source: opts.source } : {}),
      ...(opts.fixMeta ? { fix_meta: opts.fixMeta } : {}),
    })
    .select()
    .single()
  if (error) throw error
  const request = fromRow(data as Row)

  await recordEvent(request.id, null, 'open', createdBy)

  const client = await getClientById(clientId)
  // Fire-and-forget: notify() makes up to four sequential network calls (Slack
  // + Gmail, for both the client and the superadmin) and swallows every error
  // internally, so awaiting it only delays the HTTP response — the caller can't
  // act on the outcome either way. Blocking on it made the dashboard feel like
  // the status change itself was slow.
  void notify(clientId, 'request.created', {
    title: `New change request — ${client?.name ?? clientId}`,
    body: `${title}\n\n${description || '(no description)'}`
  })

  return request
}

const VALID_STATUSES: RequestStatus[] = ['open', 'in_progress', 'done', 'declined', 'cancelled']
const CANCELLABLE_STATUSES = new Set<RequestStatus>(['open', 'in_progress'])

async function getRequest(clientId: string, requestId: string): Promise<ChangeRequest | null> {
  const { data, error } = await supabase
    .from('change_requests')
    .select('*')
    .eq('client_id', clientId)
    .eq('id', requestId)
    .maybeSingle()
  if (error) { console.error('[change-requests] get error', error.message); return null }
  return data ? fromRow(data as Row) : null
}

// Status transitions are a superadmin call (they own the fulfillment work).
export async function updateRequestStatus(clientId: string, requestId: string, status: RequestStatus, changedBy: string | null): Promise<ChangeRequest> {
  if (!VALID_STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`)
  const existing = await getRequest(clientId, requestId)
  if (!existing) throw new Error('Request not found')

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

  await recordEvent(request.id, existing.status, status, changedBy)

  // Not awaited — see the note in createRequest above.
  void notify(clientId, 'request.status_changed', {
    title: `Request update — ${request.title}`,
    body: `Status changed to "${status}".`
  })

  return request
}

// Client-initiated cancel — distinct from superadmin `declined`. Only
// possible while the request hasn't been picked up/finished yet.
export async function cancelRequest(clientId: string, requestId: string, cancelledBy: string, reason: string): Promise<ChangeRequest> {
  const existing = await getRequest(clientId, requestId)
  if (!existing) throw new Error('Request not found')
  if (!CANCELLABLE_STATUSES.has(existing.status)) {
    throw new Error(`Cannot cancel a request with status "${existing.status}"`)
  }

  const { data, error } = await supabase
    .from('change_requests')
    .update({ status: 'cancelled', cancel_reason: reason, updated_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .eq('id', requestId)
    .select()
    .single()
  if (error) throw error
  const request = fromRow(data as Row)

  await recordEvent(request.id, existing.status, 'cancelled', cancelledBy, reason)

  // Not awaited — see the note in createRequest above.
  void notify(clientId, 'request.status_changed', {
    title: `Request cancelled — ${request.title}`,
    body: `Cancelled by the client. Reason: ${reason}`
  })

  return request
}

// Permanently removes a request. Events, comments and attachment ROWS all
// cascade from the change_requests FK, but the attachment FILES do not — those
// bytes live in the 'request-attachments' Storage bucket, which knows nothing
// about the foreign key. Without this they'd be orphaned in the bucket forever,
// counting against storage with nothing left pointing at them.
//
// Scoped by client_id as well as id so a request can't be deleted through the
// wrong client's route with a valid id from elsewhere.
export async function deleteRequest(clientId: string, requestId: string): Promise<void> {
  const existing = await getRequest(clientId, requestId)
  if (!existing) throw new Error('Request not found')

  const attachments = await listAttachments(requestId)
  if (attachments.length) {
    // Best-effort: a failed Storage delete must not block removing the request
    // itself, or a transient bucket error leaves an undeletable row behind.
    const { error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .remove(attachments.map(a => a.storagePath))
    if (error) console.error('[change-requests] failed to remove attachment files:', error.message)
  }

  const { error } = await supabase
    .from('change_requests')
    .delete()
    .eq('client_id', clientId)
    .eq('id', requestId)
  if (error) throw new Error(`Failed to delete request: ${error.message}`)
}

export async function listEvents(requestId: string): Promise<RequestEvent[]> {
  const { data, error } = await supabase
    .from('change_request_events')
    .select('*')
    .eq('request_id', requestId)
    .order('created_at', { ascending: true })
  if (error) { console.error('[change-requests] listEvents error', error.message); return [] }
  return (data as EventRow[]).map(eventFromRow)
}

export async function listComments(requestId: string): Promise<RequestComment[]> {
  const { data, error } = await supabase
    .from('change_request_comments')
    .select('*')
    .eq('request_id', requestId)
    .order('created_at', { ascending: true })
  if (error) { console.error('[change-requests] listComments error', error.message); return [] }
  const rows = data as CommentRow[]
  const names = await getDisplayNames(rows.map(r => r.author_id))
  return rows.map(r => commentFromRow(r, names[r.author_id] ?? 'Unknown user'))
}

// mentions: Clerk user IDs explicitly picked in the compose UI's @ picker (not
// parsed from free text — see users.ts). Each mentioned person (other than the
// author) gets a guarded, best-effort email; one failure never blocks another
// or the comment itself from saving.
export async function addComment(requestId: string, authorId: string, isSuperadmin: boolean, body: string, mentions: string[] = []): Promise<RequestComment> {
  const { data, error } = await supabase
    .from('change_request_comments')
    .insert({ request_id: requestId, author_id: authorId, is_superadmin: isSuperadmin, body, mentions })
    .select()
    .single()
  if (error) throw error
  const row = data as CommentRow

  const request = await getRequest(await clientIdForRequest(requestId) ?? '', requestId).catch(() => null)
  const names = await getDisplayNames([authorId, ...mentions])
  const toNotify = mentions.filter(id => id !== authorId)
  if (toNotify.length) {
    const authorName = names[authorId] ?? 'Someone'
    for (const userId of toNotify) {
      try {
        const email = await getUserEmail(userId)
        if (!email) continue
        await sendGuardedEmail({
          clientId: null,
          event: 'comment.mention',
          to: email,
          subject: `${authorName} mentioned you on "${request?.title ?? 'a request'}"`,
          body: `${authorName} mentioned you in a comment:\n\n"${body}"\n\nRequest: ${request?.title ?? requestId}`
        })
      } catch (err) {
        console.error('[change-requests] mention notify failed', userId, err instanceof Error ? err.message : err)
      }
    }
  }

  return commentFromRow(row, names[authorId] ?? 'Unknown user')
}

// change_request_comments doesn't carry client_id directly — look it up via
// the parent request so mention emails can link back with real context.
async function clientIdForRequest(requestId: string): Promise<string | null> {
  const { data } = await supabase.from('change_requests').select('client_id').eq('id', requestId).maybeSingle()
  return data?.client_id ?? null
}

export interface RequestDetail {
  request: ChangeRequest
  events: RequestEvent[]
  comments: RequestComment[]
}

export async function getRequestDetail(clientId: string, requestId: string): Promise<RequestDetail | null> {
  const request = await getRequest(clientId, requestId)
  if (!request) return null
  const [events, comments] = await Promise.all([listEvents(requestId), listComments(requestId)])
  return { request, events, comments }
}
