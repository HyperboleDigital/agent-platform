import { randomUUID } from 'crypto'
import { supabase } from './supabase'

// Exported so deleteRequest() in change-requests.ts can clean up the FILES when
// a request is removed — the DB rows cascade, the Storage objects do not.
export const ATTACHMENT_BUCKET = 'request-attachments'
const BUCKET = ATTACHMENT_BUCKET
const SIGNED_URL_TTL_SECONDS = 5 * 60

export interface RequestAttachment {
  id: string
  requestId: string
  filename: string
  contentType: string
  sizeBytes: number
  storagePath: string
  uploadedBy: string | null
  createdAt: string
}

interface Row {
  id: string
  request_id: string
  filename: string
  content_type: string
  size_bytes: number
  storage_path: string
  uploaded_by: string | null
  created_at: string
}

function fromRow(r: Row): RequestAttachment {
  return {
    id: r.id,
    requestId: r.request_id,
    filename: r.filename,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    storagePath: r.storage_path,
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at
  }
}

export async function listAttachments(requestId: string): Promise<RequestAttachment[]> {
  const { data, error } = await supabase
    .from('change_request_attachments')
    .select('*')
    .eq('request_id', requestId)
    .order('created_at', { ascending: true })
  if (error) { console.error('[attachments] list error', error.message); return [] }
  return (data as Row[]).map(fromRow)
}

export async function uploadAttachment(
  requestId: string, filename: string, contentType: string, buffer: Buffer, uploadedBy: string | null
): Promise<RequestAttachment> {
  const storagePath = `${requestId}/${randomUUID()}-${filename}`
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType, upsert: false
  })
  if (uploadError) throw uploadError

  const { data, error } = await supabase
    .from('change_request_attachments')
    .insert({
      request_id: requestId,
      filename,
      content_type: contentType,
      size_bytes: buffer.length,
      storage_path: storagePath,
      uploaded_by: uploadedBy
    })
    .select()
    .single()
  if (error) throw error
  return fromRow(data as Row)
}

// Only used to authorize a signed-URL mint request against the request it
// claims to belong to (so one client can't fetch another's attachment by id).
export async function getAttachment(attachmentId: string): Promise<RequestAttachment | null> {
  const { data, error } = await supabase
    .from('change_request_attachments')
    .select('*')
    .eq('id', attachmentId)
    .maybeSingle()
  if (error) { console.error('[attachments] get error', error.message); return null }
  return data ? fromRow(data as Row) : null
}

export async function getSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
  if (error) throw error
  return data.signedUrl
}
