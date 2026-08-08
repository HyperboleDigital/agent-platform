import { randomUUID } from 'crypto'
import { supabase } from '../lib/supabase'
import { embeddingsEnabled, embedQuery, embedDocuments, chunkText } from '../lib/embeddings'
import { deleteKnowledgeFile } from '../lib/knowledge-files'

interface DocRow {
  id?: string
  title: string
  content: string
  url?: string | null
  similarity?: number
}

// Structured result of a knowledge-base search. `context` is the formatted text
// handed to the model; `matches` carries the instrumentation the orchestrator
// needs — which chunks were retrieved and (for vector search) how close the top
// hit was. `queryEmbedding` is the query vector when one was computed, reused
// downstream (message_logs.query_embedding) so Top-Questions clustering is free.
export interface SearchResult {
  context: string
  matches: { id: string | null; similarity: number | null; title: string }[]
  // Top match cosine similarity (0..1) when vector search ran, else null. This
  // is the real retrieval-confidence signal — null means we fell back to
  // keyword search, where there's no comparable score.
  topSimilarity: number | null
  queryEmbedding: number[] | null
}

const NO_RESULTS = 'No relevant information found in the knowledge base.'

function format(rows: DocRow[]): string {
  return rows
    .map(d => {
      const source = d.url ? `\n(Source: ${d.url})` : ''
      return `## ${d.title}\n${d.content}${source}`
    })
    .join('\n\n---\n\n')
}

function toMatches(rows: DocRow[]): SearchResult['matches'] {
  return rows.map(r => ({ id: r.id ?? null, similarity: r.similarity ?? null, title: r.title }))
}

// Full search with instrumentation. Used by the chat orchestrator, which needs
// the retrieved doc ids + top similarity for logging and the low-confidence
// fallback. Prefer searchDocs() when you only need the text (see content.ts).
export async function searchDocsDetailed(query: string, clientId: string): Promise<SearchResult> {
  // 1. Vector search when embeddings are configured.
  if (embeddingsEnabled()) {
    try {
      const embedding = await embedQuery(query)
      const { data, error } = await supabase.rpc('match_knowledge', {
        query_embedding: embedding,
        match_client_id: clientId,
        match_count: 3
      })
      if (!error && data?.length) {
        const rows = data as DocRow[]
        return {
          context: format(rows),
          matches: toMatches(rows),
          topSimilarity: rows[0]?.similarity ?? null,
          queryEmbedding: embedding
        }
      }
      // Embeddings configured but no rows (or an error) → fall through to
      // keyword search, but keep the query embedding so it's still logged.
      return { ...(await keywordSearch(query, clientId)), queryEmbedding: embedding }
    } catch (err) {
      console.error('[knowledge] vector search failed, falling back', err)
    }
  }

  return { ...(await keywordSearch(query, clientId)), queryEmbedding: null }
}

// Full-text + ilike fallback. No similarity score exists for keyword matches,
// so topSimilarity is null (the orchestrator treats null as "can't judge
// confidence" and won't trip the low-confidence fallback on keyword-only setups).
async function keywordSearch(query: string, clientId: string): Promise<Omit<SearchResult, 'queryEmbedding'>> {
  // 2. Full-text search.
  let { data } = await supabase
    .from('knowledge_base')
    .select('id, content, title, url')
    .eq('client_id', clientId)
    .textSearch('content', query, { type: 'websearch' })
    .limit(3)

  // 3. ilike fallback if full-text returns nothing.
  if (!data?.length) {
    const firstWord = query.split(' ')[0]
    ;({ data } = await supabase
      .from('knowledge_base')
      .select('id, content, title, url')
      .eq('client_id', clientId)
      .ilike('content', `%${firstWord}%`)
      .limit(3))
  }

  const rows = (data ?? []) as DocRow[]
  return {
    context: rows.length ? format(rows) : NO_RESULTS,
    matches: toMatches(rows),
    topSimilarity: null
  }
}

// Text-only convenience wrapper for callers that don't need instrumentation
// (e.g. content generation grounds a draft in the KB — see lib/content.ts).
export async function searchDocs(query: string, clientId: string): Promise<string> {
  return (await searchDocsDetailed(query, clientId)).context
}

export interface KnowledgeDoc {
  id: string          // document_id — groups every chunk from one upload/paste
  title: string
  url: string | null
  description: string | null
  fileId: string | null
  created_at: string
}

interface DocumentGroupRow {
  document_id: string
  title: string
  url: string | null
  description: string | null
  file_id: string | null
  created_at: string
}

// Whether migrate_2026-07-16_knowledge-delete.sql has been applied yet
// (document_id, file_id, description all land together in that one
// migration). Probed once and cached — until it runs, we transparently fall
// back to the pre-migration behavior (one row per chunk, no per-document
// grouping/delete/description) rather than erroring, so listing/uploading
// never breaks on migration lag.
let documentColumnsSupported: boolean | null = null
async function hasDocumentColumns(): Promise<boolean> {
  if (documentColumnsSupported !== null) return documentColumnsSupported
  const { error } = await supabase.from('knowledge_base').select('document_id, file_id, description').limit(1)
  documentColumnsSupported = !error
  if (!documentColumnsSupported) {
    console.warn('[knowledge-base] document_id/file_id/description columns not found — run supabase/migrate_2026-07-16_knowledge-delete.sql to enable per-document delete/replace/description. Falling back to legacy per-chunk listing for now.')
  }
  return documentColumnsSupported
}

// knowledge_base stores one row per CHUNK (chunkText splits ingested
// content) — group by document_id so the dashboard lists/deletes a whole
// upload as one unit, not chunk-by-chunk.
export async function listDocuments(clientId: string): Promise<KnowledgeDoc[]> {
  if (await hasDocumentColumns()) {
    const { data, error } = await supabase
      .from('knowledge_base')
      .select('document_id, title, url, description, file_id, created_at')
      .eq('client_id', clientId)
      .order('created_at', { ascending: true })
    if (error) { console.error('[knowledge-base] listDocuments error', error.message); return [] }

    const byDocument = new Map<string, DocumentGroupRow>()
    for (const row of (data ?? []) as DocumentGroupRow[]) {
      if (!byDocument.has(row.document_id)) byDocument.set(row.document_id, row)
    }
    return Array.from(byDocument.values())
      .map(r => ({ id: r.document_id, title: r.title, url: r.url, description: r.description, fileId: r.file_id, created_at: r.created_at }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
  }

  // Legacy fallback: one row per chunk, each listed as its own "document".
  const { data, error } = await supabase
    .from('knowledge_base')
    .select('id, title, url, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
  if (error) { console.error('[knowledge-base] listDocuments (legacy) error', error.message); return [] }
  return (data ?? []).map(r => ({ id: r.id, title: r.title, url: r.url, description: null, fileId: null, created_at: r.created_at }))
}

export interface AddDocumentOptions {
  url?: string
  fileId?: string
  description?: string
}

// Chunks content and stores one row per chunk (all sharing one document_id),
// embedding each when Voyage is configured. `fileId` links the chunks back
// to the original uploaded file (omit for pasted-text documents).
export async function addDocument(
  clientId: string,
  title: string,
  content: string,
  options: AddDocumentOptions = {}
): Promise<{ documentId: string; ids: string[] }> {
  const { url, fileId, description } = options
  const chunks = chunkText(content)
  const embeddings = embeddingsEnabled() ? await embedDocuments(chunks) : []
  const useDocumentColumns = await hasDocumentColumns()
  const documentId = randomUUID()

  const rows = chunks.map((chunk, i) => ({
    client_id: clientId,
    ...(useDocumentColumns ? { document_id: documentId, file_id: fileId ?? null, description: description ?? null } : {}),
    title,
    content: chunk,
    url: url ?? null,
    embedding: embeddings[i] ?? null
  }))

  const { data, error } = await supabase.from('knowledge_base').insert(rows).select('id')
  if (error) throw error
  const ids = (data as { id: string }[]).map(r => r.id)
  // Legacy fallback: without a document_id column, each chunk row is its own
  // "document" in listDocuments above — hand back the first chunk's id so
  // callers still get a stable reference.
  return { documentId: useDocumentColumns ? documentId : ids[0], ids }
}

// Deletes every chunk in a document, and — if the document came from an
// uploaded file — the original file's bytes + metadata row too.
export async function deleteDocument(clientId: string, documentId: string): Promise<void> {
  const useDocumentColumns = await hasDocumentColumns()
  const matchColumn = useDocumentColumns ? 'document_id' : 'id'

  const { data: rows, error: selectError } = await supabase
    .from('knowledge_base')
    .select(useDocumentColumns ? 'file_id' : 'id')
    .eq('client_id', clientId)
    .eq(matchColumn, documentId)
  if (selectError) throw selectError

  const { error: deleteError } = await supabase
    .from('knowledge_base')
    .delete()
    .eq('client_id', clientId)
    .eq(matchColumn, documentId)
  if (deleteError) throw deleteError

  if (useDocumentColumns) {
    const fileIds = [...new Set((rows ?? []).map(r => (r as { file_id: string | null }).file_id).filter(Boolean))] as string[]
    await Promise.all(fileIds.map(id => deleteKnowledgeFile(id)))
  }
}

// Updates the user-editable description on every chunk row of a document
// (title/url are already duplicated per-chunk this way — same pattern).
export async function updateDocumentDescription(clientId: string, documentId: string, description: string): Promise<void> {
  if (!(await hasDocumentColumns())) {
    throw new Error('Descriptions require supabase/migrate_2026-07-16_knowledge-delete.sql to be applied first.')
  }
  const { error } = await supabase
    .from('knowledge_base')
    .update({ description })
    .eq('client_id', clientId)
    .eq('document_id', documentId)
  if (error) throw error
}
