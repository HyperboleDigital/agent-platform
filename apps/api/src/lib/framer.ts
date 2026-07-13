import type { connect as ConnectFn, Field } from 'framer-api'
import { supabase } from './supabase'
import { encryptSecret, decryptSecret } from './crypto'

// Publishes approved blog posts to a client's Framer site via the official
// Server API. Framer's connect() opens a live session against a whole
// PROJECT (not just a collection) and must be explicitly disconnected — every
// call here is wrapped to guarantee cleanup even on error.
//
// framer-api ships ESM with top-level await, which tsx's CJS transform
// pipeline can't statically import in this CommonJS project — loaded via
// dynamic import() instead, which goes through Node's native ESM loader.
let connectFn: typeof ConnectFn | null = null
async function getConnect(): Promise<typeof ConnectFn> {
  if (!connectFn) connectFn = (await import('framer-api')).connect
  return connectFn
}

export interface FramerFieldMapping {
  title?: string
  body?: string
  slug?: string
  metaDescription?: string
}

export interface FramerConnection {
  clientId: string
  projectUrl: string
  collectionId: string
  fieldMapping: FramerFieldMapping
}

interface ConnectionRow {
  client_id: string
  project_url: string
  api_key_enc: string
  collection_id: string
  field_mapping: FramerFieldMapping
}

function fromRow(r: ConnectionRow): FramerConnection {
  return { clientId: r.client_id, projectUrl: r.project_url, collectionId: r.collection_id, fieldMapping: r.field_mapping ?? {} }
}

// Public info only — never returns the decrypted API key to a caller outside
// this module.
export async function getFramerConnection(clientId: string): Promise<FramerConnection | null> {
  const { data } = await supabase.from('framer_connections').select('*').eq('client_id', clientId).maybeSingle()
  return data ? fromRow(data as ConnectionRow) : null
}

// apiKey is optional on update — omit it (or pass empty string) to keep the
// currently stored key unchanged. Required when there's no existing row.
export async function saveFramerConnection(
  clientId: string,
  projectUrl: string,
  apiKey: string | undefined,
  collectionId: string,
  fieldMapping: FramerFieldMapping
): Promise<FramerConnection> {
  if (!apiKey) {
    const existing = await getFramerConnection(clientId)
    if (!existing) throw new Error('An API key is required for a new Framer connection')
  }

  const { data, error } = await supabase
    .from('framer_connections')
    .upsert({
      client_id: clientId,
      project_url: projectUrl,
      ...(apiKey ? { api_key_enc: encryptSecret(apiKey) } : {}),
      collection_id: collectionId,
      field_mapping: fieldMapping,
      updated_at: new Date().toISOString()
    }, { onConflict: 'client_id' })
    .select()
    .single()
  if (error) throw error
  return fromRow(data as ConnectionRow)
}

export async function deleteFramerConnection(clientId: string): Promise<void> {
  const { error } = await supabase.from('framer_connections').delete().eq('client_id', clientId)
  if (error) throw error
}

// Opens a Framer session, runs `fn`, and disconnects even on error. The
// session is per-call rather than pooled — publishes are infrequent (human
// review gates every one), so connection reuse isn't worth the complexity.
async function withFramer<T>(clientId: string, fn: (framer: Awaited<ReturnType<typeof ConnectFn>>) => Promise<T>): Promise<T> {
  const { data } = await supabase.from('framer_connections').select('*').eq('client_id', clientId).maybeSingle()
  if (!data) throw new Error('No Framer connection configured for this client')
  const row = data as ConnectionRow
  const apiKey = decryptSecret(row.api_key_enc)

  const connect = await getConnect()
  const framer = await connect(row.project_url, apiKey)
  try {
    return await fn(framer)
  } finally {
    await framer.disconnect().catch(() => {})
  }
}

export interface FramerCollectionField {
  id: string
  name: string
  type: string
}

// Lists the fields on the configured collection, for the mapping UI.
export async function listCollectionFields(clientId: string): Promise<FramerCollectionField[]> {
  return withFramer(clientId, async framer => {
    const conn = await getFramerConnection(clientId)
    if (!conn) throw new Error('No Framer connection configured')
    const collection = await framer.getCollection(conn.collectionId)
    if (!collection) throw new Error(`Collection ${conn.collectionId} not found in this Framer project`)
    const fields: Field[] = await collection.getFields()
    return fields.map(f => ({ id: f.id, name: f.name, type: f.type }))
  })
}

// Very small markdown -> HTML converter covering exactly what the content
// engine's prompt produces (##/### headings, paragraphs, bullet lists,
// bold, links) — not a general-purpose renderer. Framer's formattedText
// field defaults to HTML content type.
export function markdownToHtml(md: string): string {
  const withoutComments = md.replace(/<!--[\s\S]*?-->/g, '') // strip internal-link-suggestion comments
  const lines = withoutComments.split('\n')
  const html: string[] = []
  let inList = false

  const inline = (text: string): string =>
    text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')

  const closeList = () => { if (inList) { html.push('</ul>'); inList = false } }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { closeList(); continue }
    if (line.startsWith('### ')) { closeList(); html.push(`<h3>${inline(line.slice(4))}</h3>`); continue }
    if (line.startsWith('## ')) { closeList(); html.push(`<h2>${inline(line.slice(3))}</h2>`); continue }
    if (line.startsWith('# ')) { closeList(); html.push(`<h2>${inline(line.slice(2))}</h2>`); continue }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      if (!inList) { html.push('<ul>'); inList = true }
      html.push(`<li>${inline(line.slice(2))}</li>`)
      continue
    }
    closeList()
    html.push(`<p>${inline(line)}</p>`)
  }
  closeList()
  return html.join('\n')
}

export interface PublishResult {
  itemId: string
}

// Publishes (creates or updates) one CMS item from a blog post. Never
// silently loses content: any failure here leaves the post's DB row
// untouched (still `approved`), so nothing is lost and the caller can retry.
export async function publishToFramer(
  clientId: string,
  post: { id: string; title: string; slug: string; metaDescription: string; contentMd: string; framerItemId: string | null }
): Promise<PublishResult> {
  const conn = await getFramerConnection(clientId)
  if (!conn) throw new Error('No Framer connection configured for this client')
  const mapping = conn.fieldMapping
  if (!mapping.title || !mapping.body) {
    throw new Error('Framer field mapping is incomplete — map at least a title and body field')
  }

  return withFramer(clientId, async framer => {
    const collection = await framer.getCollection(conn.collectionId)
    if (!collection) throw new Error(`Collection ${conn.collectionId} not found in this Framer project`)

    const fieldData: Record<string, { type: string; value: string; contentType?: string }> = {
      [mapping.title!]: { type: 'string', value: post.title }
    }
    fieldData[mapping.body!] = { type: 'formattedText', value: markdownToHtml(post.contentMd), contentType: 'html' }
    if (mapping.metaDescription) fieldData[mapping.metaDescription] = { type: 'string', value: post.metaDescription }

    await collection.addItems([{
      ...(post.framerItemId ? { id: post.framerItemId } : {}),
      slug: post.slug,
      fieldData: fieldData as never
    }])

    // addItems doesn't return the created item's ID directly when creating
    // (only when updating an existing one) — look it up by slug to get it.
    if (post.framerItemId) return { itemId: post.framerItemId }
    const items = await collection.getItems()
    const created = items.find(i => i.slug === post.slug)
    if (!created) throw new Error('Framer accepted the publish but the item could not be found afterward')
    return { itemId: created.id }
  })
}
