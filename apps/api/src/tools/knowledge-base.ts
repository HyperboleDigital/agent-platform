import { supabase } from '../lib/supabase'

export async function searchDocs(query: string, knowledgeBaseIds: string[]): Promise<string> {
  if (knowledgeBaseIds.length === 0) return 'No knowledge base configured for this client.'
  const { data, error } = await supabase
    .from('knowledge_base')
    .select('content, title')
    .in('id', knowledgeBaseIds)
    .textSearch('content', query, { type: 'websearch' })
    .limit(3)
  if (error || !data?.length) return 'No relevant information found in the knowledge base.'
  return data.map((d: { title: string; content: string }) => `## ${d.title}\n${d.content}`).join('\n\n---\n\n')
}

export async function addDocument(clientId: string, title: string, content: string): Promise<string> {
  const { data, error } = await supabase
    .from('knowledge_base')
    .insert({ client_id: clientId, title, content })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}
