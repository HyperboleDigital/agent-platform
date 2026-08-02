import { randomUUID } from 'crypto'
import { supabase } from './supabase'

// The operator's design inspiration library. Concept generation has no
// built-in taste and no fixed templates — what it imitates comes entirely from
// here, which is the point: design direction stays with the operator rather
// than being whatever the model reaches for by default.
//
// Images are stored private and streamed back through the API (never a signed
// *.supabase.co URL) for the same reason as prospect mockups, plus these may
// be licensed third-party work.

const BUCKET = 'design-inspo'

// Vision calls are the cost driver and attention is finite — past a handful of
// references the model averages them into mush rather than following any one.
const MAX_REFERENCES_PER_GENERATION = 4

export interface DesignReference {
  id: string
  label: string
  vertical: string | null
  notes: string | null
  storagePath: string
  contentType: string
  sizeBytes: number | null
  active: boolean
  createdAt: string
}

interface Row {
  id: string
  label: string
  vertical: string | null
  notes: string | null
  storage_path: string
  content_type: string
  size_bytes: number | null
  active: boolean
  created_at: string
}

function fromRow(r: Row): DesignReference {
  return {
    id: r.id,
    label: r.label,
    vertical: r.vertical,
    notes: r.notes,
    storagePath: r.storage_path,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    active: r.active,
    createdAt: r.created_at
  }
}

export async function listReferences(opts: { includeInactive?: boolean } = {}): Promise<DesignReference[]> {
  let query = supabase.from('design_references').select('*').order('created_at', { ascending: false })
  if (!opts.includeInactive) query = query.eq('active', true)
  const { data, error } = await query
  if (error) throw new Error(`Failed to list design references: ${error.message}`)
  return ((data ?? []) as Row[]).map(fromRow)
}

export async function getReference(id: string): Promise<DesignReference | null> {
  const { data, error } = await supabase.from('design_references').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`Failed to load design reference: ${error.message}`)
  return data ? fromRow(data as Row) : null
}

// Picks which references steer one generation. Vertical-specific ones win, and
// untagged ones fill any remaining slots — so a thin library still produces
// something rather than nothing, and a well-tagged one stays on-vertical.
export async function selectReferencesForVertical(vertical: string | null): Promise<DesignReference[]> {
  const all = await listReferences()
  if (all.length === 0) return []

  const matching = vertical
    ? all.filter(r => r.vertical && r.vertical.toLowerCase() === vertical.toLowerCase())
    : []
  const untagged = all.filter(r => !r.vertical)

  return [...matching, ...untagged].slice(0, MAX_REFERENCES_PER_GENERATION)
}

export async function uploadReference(
  input: { label: string; vertical?: string | null; notes?: string | null; contentType: string; buffer: Buffer }
): Promise<DesignReference> {
  const storagePath = `${randomUUID()}`
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, input.buffer, { contentType: input.contentType, upsert: false })
  if (uploadError) throw new Error(`Failed to store design reference: ${uploadError.message}`)

  const { data, error } = await supabase
    .from('design_references')
    .insert({
      label: input.label,
      vertical: input.vertical?.trim() || null,
      notes: input.notes?.trim() || null,
      storage_path: storagePath,
      content_type: input.contentType,
      size_bytes: input.buffer.length
    })
    .select()
    .single()
  if (error) throw new Error(`Failed to record design reference: ${error.message}`)
  return fromRow(data as Row)
}

export async function updateReference(
  id: string,
  patch: { label?: string; vertical?: string | null; notes?: string | null; active?: boolean }
): Promise<DesignReference> {
  const { data, error } = await supabase
    .from('design_references')
    .update({
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.vertical !== undefined ? { vertical: patch.vertical?.trim() || null } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {})
    })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(`Failed to update design reference: ${error.message}`)
  return fromRow(data as Row)
}

// Storage object goes first: an orphaned row is visible and fixable, an
// orphaned blob is invisible and bills forever.
export async function deleteReference(id: string): Promise<void> {
  const reference = await getReference(id)
  if (!reference) return

  const { error: storageError } = await supabase.storage.from(BUCKET).remove([reference.storagePath])
  if (storageError) throw new Error(`Failed to delete design reference image: ${storageError.message}`)

  const { error } = await supabase.from('design_references').delete().eq('id', id)
  if (error) throw new Error(`Failed to delete design reference: ${error.message}`)
}

export async function getReferenceImage(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath)
  if (error) throw new Error(`Failed to load design reference image: ${error.message}`)
  return Buffer.from(await data.arrayBuffer())
}
