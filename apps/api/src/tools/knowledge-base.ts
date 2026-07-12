import { supabase } from '../lib/supabase'
import { embeddingsEnabled, embedQuery, embedDocuments, chunkText } from '../lib/embeddings'

interface DocRow {
  title: string
  content: string
  url?: string | null
}

function format(rows: DocRow[]): string {
  return rows
    .map(d => {
      const source = d.url ? `\n(Source: ${d.url})` : ''
      return `## ${d.title}\n${d.content}${source}`
    })
    .join('\n\n---\n\n')
}

export async function searchDocs(query: string, clientId: string): Promise<string> {
  // 1. Vector search when embeddings are configured.
  if (embeddingsEnabled()) {
    try {
      const embedding = await embedQuery(query)
      const { data, error } = await supabase.rpc('match_knowledge', {
        query_embedding: embedding,
        match_client_id: clientId,
        match_count: 3
      })
      if (!error && data?.length) return format(data as DocRow[])
    } catch (err) {
      console.error('[knowledge] vector search failed, falling back', err)
    }
  }

  // 2. Full-text search.
  let { data } = await supabase
    .from('knowledge_base')
    .select('content, title, url')
    .eq('client_id', clientId)
    .textSearch('content', query, { type: 'websearch' })
    .limit(3)

  // 3. ilike fallback if full-text returns nothing.
  if (!data?.length) {
    const firstWord = query.split(' ')[0]
    ;({ data } = await supabase
      .from('knowledge_base')
      .select('content, title, url')
      .eq('client_id', clientId)
      .ilike('content', `%${firstWord}%`)
      .limit(3))
  }

  if (!data?.length) return 'No relevant information found in the knowledge base.'
  return format(data as DocRow[])
}

export interface KnowledgeDoc {
  id: string
  title: string
  url: string | null
  created_at: string
}

export async function listDocuments(clientId: string): Promise<KnowledgeDoc[]> {
  const { data } = await supabase
    .from('knowledge_base')
    .select('id, title, url, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
  return (data ?? []) as KnowledgeDoc[]
}

// Chunks content and stores one row per chunk, embedding each when Voyage is
// configured. Returns the ids of the inserted rows.
export async function addDocument(
  clientId: string,
  title: string,
  content: string,
  url?: string
): Promise<string[]> {
  const chunks = chunkText(content)
  const embeddings = embeddingsEnabled() ? await embedDocuments(chunks) : []

  const rows = chunks.map((chunk, i) => ({
    client_id: clientId,
    title,
    content: chunk,
    url: url ?? null,
    embedding: embeddings[i] ?? null
  }))

  const { data, error } = await supabase.from('knowledge_base').insert(rows).select('id')
  if (error) throw error
  return (data as { id: string }[]).map(r => r.id)
}
