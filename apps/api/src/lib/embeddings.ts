// Voyage AI embeddings (Anthropic's recommended embedding partner).
// voyage-3.5-lite defaults to 1024 dimensions — matches knowledge_base.embedding
// vector(1024). If VOYAGE_API_KEY is unset, callers fall back to full-text search.

const MODEL = 'voyage-3.5-lite'
const ENDPOINT = 'https://api.voyageai.com/v1/embeddings'

export function embeddingsEnabled(): boolean {
  return !!process.env.VOYAGE_API_KEY
}

type InputType = 'query' | 'document'

async function embed(input: string[], inputType: InputType): Promise<number[][]> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`
    },
    body: JSON.stringify({ model: MODEL, input, input_type: inputType })
  })
  if (!res.ok) {
    throw new Error(`Voyage API error ${res.status}: ${await res.text()}`)
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] }
  return json.data.map(d => d.embedding)
}

export async function embedQuery(text: string): Promise<number[]> {
  const [vec] = await embed([text], 'query')
  return vec
}

export async function embedDocuments(texts: string[]): Promise<number[][]> {
  if (!texts.length) return []
  return embed(texts, 'document')
}

// Split long text into ~500-token chunks (~2000 chars), breaking on paragraph
// boundaries so chunks stay semantically coherent.
export function chunkText(text: string, maxChars = 2000): string[] {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const chunks: string[] = []
  let current = ''

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      if (current) { chunks.push(current); current = '' }
      // Hard-split an oversized paragraph.
      for (let i = 0; i < para.length; i += maxChars) {
        chunks.push(para.slice(i, i + maxChars))
      }
      continue
    }
    if ((current + '\n\n' + para).length > maxChars) {
      chunks.push(current)
      current = para
    } else {
      current = current ? `${current}\n\n${para}` : para
    }
  }
  if (current) chunks.push(current)
  return chunks.length ? chunks : [text]
}
