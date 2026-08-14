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
//
// References are organized into operator-named libraries (design_libraries) —
// e.g. "Roofing", "Med Spa" — chosen explicitly per prospect at generation
// time (see selectReferencesForLibrary in prospect-mockups.ts). This replaced
// a free-text `vertical` tag that had to exact-match a prospect's raw Google
// Places category string; see migrate_2026-08-08b_design-libraries.sql.

const BUCKET = 'design-inspo'

// Vision calls are the cost driver and attention is finite — past a handful of
// references the model averages them into mush rather than following any one.
export const MAX_REFERENCES_PER_GENERATION = 4

// ── Libraries ─────────────────────────────────────────────────────────────────

export interface DesignLibrary {
  id: string
  name: string
  description: string | null
  createdAt: string
  // Not persisted — computed for the management UI so a library can show its
  // size without a second round-trip per card.
  referenceCount?: number
}

interface LibraryRow {
  id: string
  name: string
  description: string | null
  created_at: string
}

function libraryFromRow(r: LibraryRow): DesignLibrary {
  return { id: r.id, name: r.name, description: r.description, createdAt: r.created_at }
}

export async function listLibraries(): Promise<DesignLibrary[]> {
  const [{ data: libs, error: libErr }, { data: refs, error: refErr }] = await Promise.all([
    supabase.from('design_libraries').select('*').order('name', { ascending: true }),
    supabase.from('design_references').select('library_id').eq('active', true)
  ])
  if (libErr) throw new Error(`Failed to list design libraries: ${libErr.message}`)
  if (refErr) throw new Error(`Failed to count design references: ${refErr.message}`)

  const counts = new Map<string, number>()
  for (const r of (refs ?? []) as { library_id: string | null }[]) {
    if (r.library_id) counts.set(r.library_id, (counts.get(r.library_id) ?? 0) + 1)
  }
  return ((libs ?? []) as LibraryRow[]).map(row => ({ ...libraryFromRow(row), referenceCount: counts.get(row.id) ?? 0 }))
}

export async function createLibrary(input: { name: string; description?: string | null }): Promise<DesignLibrary> {
  const name = input.name.trim()
  if (!name) throw new Error('Library name is required')
  const { data, error } = await supabase
    .from('design_libraries')
    .insert({ name, description: input.description?.trim() || null })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') throw new Error(`A library named "${name}" already exists`)
    throw new Error(`Failed to create design library: ${error.message}`)
  }
  return libraryFromRow(data as LibraryRow)
}

export async function updateLibrary(id: string, patch: { name?: string; description?: string | null }): Promise<DesignLibrary> {
  const { data, error } = await supabase
    .from('design_libraries')
    .update({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {})
    })
    .eq('id', id)
    .select()
    .single()
  if (error) {
    if (error.code === '23505') throw new Error(`A library named "${patch.name}" already exists`)
    throw new Error(`Failed to update design library: ${error.message}`)
  }
  return libraryFromRow(data as LibraryRow)
}

// References in a deleted library are NOT deleted — they fall back to
// "unassigned" (library_id set null via the FK) rather than losing images.
export async function deleteLibrary(id: string): Promise<void> {
  const { error } = await supabase.from('design_libraries').delete().eq('id', id)
  if (error) throw new Error(`Failed to delete design library: ${error.message}`)
}

// ── References ────────────────────────────────────────────────────────────────

export interface DesignReference {
  id: string
  label: string
  libraryId: string | null
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
  library_id: string | null
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
    libraryId: r.library_id,
    notes: r.notes,
    storagePath: r.storage_path,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    active: r.active,
    createdAt: r.created_at
  }
}

export async function listReferences(opts: { includeInactive?: boolean; libraryId?: string | null } = {}): Promise<DesignReference[]> {
  let query = supabase.from('design_references').select('*').order('created_at', { ascending: false })
  if (!opts.includeInactive) query = query.eq('active', true)
  if (opts.libraryId !== undefined) {
    query = opts.libraryId === null ? query.is('library_id', null) : query.eq('library_id', opts.libraryId)
  }
  const { data, error } = await query
  if (error) throw new Error(`Failed to list design references: ${error.message}`)
  return ((data ?? []) as Row[]).map(fromRow)
}

export async function getReference(id: string): Promise<DesignReference | null> {
  const { data, error } = await supabase.from('design_references').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`Failed to load design reference: ${error.message}`)
  return data ? fromRow(data as Row) : null
}

export async function uploadReference(
  input: { label: string; libraryId?: string | null; notes?: string | null; contentType: string; buffer: Buffer }
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
      library_id: input.libraryId ?? null,
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
  patch: { label?: string; libraryId?: string | null; notes?: string | null; active?: boolean }
): Promise<DesignReference> {
  const { data, error } = await supabase
    .from('design_references')
    .update({
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.libraryId !== undefined ? { library_id: patch.libraryId } : {}),
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

// Picks which references steer one generation — exclusively from ONE pool:
// the chosen library if the operator picked one for this prospect, or the
// unassigned ("applies to everyone") pool otherwise. Deliberately not
// blended: choosing a library means using that library, and nothing else.
// See prospect-mockups.ts buildGenerationContext, the only caller.
// `primaryId` pins one reference to the front of the list. Four references of
// equal weight get averaged into a generic middle — naming one as the layout
// to follow closely (with the rest as secondary style influence) is how a
// designer actually works from a main comp plus a mood board, and it's what
// the prompt keys off to give that first image structural authority.
export async function selectReferencesForLibrary(
  libraryId: string | null | undefined,
  primaryId?: string | null
): Promise<DesignReference[]> {
  const refs = await listReferences({ libraryId: libraryId ?? null })
  const ordered = primaryId
    ? [...refs.filter(r => r.id === primaryId), ...refs.filter(r => r.id !== primaryId)]
    : refs
  return ordered.slice(0, MAX_REFERENCES_PER_GENERATION)
}
