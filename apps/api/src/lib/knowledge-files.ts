import { randomUUID } from 'crypto'
import { supabase } from './supabase'

const BUCKET = 'knowledge-files'
const SIGNED_URL_TTL_SECONDS = 5 * 60

export interface KnowledgeFile {
  id: string
  clientId: string
  filename: string
  contentType: string
  sizeBytes: number
  storagePath: string
  uploadedBy: string | null
  createdAt: string
}

interface Row {
  id: string
  client_id: string
  filename: string
  content_type: string
  size_bytes: number
  storage_path: string
  uploaded_by: string | null
  created_at: string
}

function fromRow(r: Row): KnowledgeFile {
  return {
    id: r.id,
    clientId: r.client_id,
    filename: r.filename,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    storagePath: r.storage_path,
    uploadedBy: r.uploaded_by,
    createdAt: r.created_at
  }
}

export async function listKnowledgeFiles(clientId: string): Promise<KnowledgeFile[]> {
  const { data, error } = await supabase
    .from('knowledge_files')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
  if (error) { console.error('[knowledge-files] list error', error.message); return [] }
  return (data as Row[]).map(fromRow)
}

// Stores the original file bytes alongside the extracted/chunked text already
// written to knowledge_base — lets the dashboard show a preview thumbnail,
// which extracted text alone can't support.
export async function uploadKnowledgeFile(
  clientId: string, filename: string, contentType: string, buffer: Buffer, uploadedBy: string | null
): Promise<KnowledgeFile> {
  const storagePath = `${clientId}/${randomUUID()}-${filename}`
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType, upsert: false
  })
  if (uploadError) throw uploadError

  const { data, error } = await supabase
    .from('knowledge_files')
    .insert({
      client_id: clientId,
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

export async function getKnowledgeFile(fileId: string): Promise<KnowledgeFile | null> {
  const { data, error } = await supabase
    .from('knowledge_files')
    .select('*')
    .eq('id', fileId)
    .maybeSingle()
  if (error) { console.error('[knowledge-files] get error', error.message); return null }
  return data ? fromRow(data as Row) : null
}

export async function getSignedUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
  if (error) throw error
  return data.signedUrl
}

export async function deleteKnowledgeFile(fileId: string): Promise<void> {
  const file = await getKnowledgeFile(fileId)
  if (!file) return
  const { error: storageError } = await supabase.storage.from(BUCKET).remove([file.storagePath])
  if (storageError) console.error('[knowledge-files] failed to delete storage object', storageError.message)
  const { error } = await supabase.from('knowledge_files').delete().eq('id', fileId)
  if (error) throw error
}
