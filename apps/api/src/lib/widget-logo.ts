import { randomUUID } from 'crypto'
import { supabase } from './supabase'

// Uploaded chat-widget logos.
//
// Stored in a private bucket and streamed back through our own origin by
// GET /widget-config/:clientId/logo, NOT via a signed Supabase URL: the widget
// stays embedded on a client's site indefinitely, and a signed URL would expire
// while it's still in use.

const BUCKET = 'widget-logos'

export const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif']

// Logos are small by nature; a multi-MB one is a mistake, and every visitor to
// the client's site pays for it on load.
export const MAX_LOGO_BYTES = 1024 * 1024

export async function uploadLogo(
  clientId: string,
  contentType: string,
  buffer: Buffer
): Promise<{ storagePath: string; contentType: string }> {
  const storagePath = `${clientId}/${randomUUID()}`
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType, upsert: false })
  if (error) throw new Error(`Failed to store logo: ${error.message}`)
  return { storagePath, contentType }
}

export async function getLogo(storagePath: string): Promise<Buffer> {
  const { data, error } = await supabase.storage.from(BUCKET).download(storagePath)
  if (error) throw new Error(`Failed to load logo: ${error.message}`)
  return Buffer.from(await data.arrayBuffer())
}

// Best-effort: a replaced logo's bytes are worth reclaiming, but a failure here
// must not fail the upload that triggered it.
export async function deleteLogo(storagePath: string): Promise<void> {
  await supabase.storage.from(BUCKET).remove([storagePath]).catch(() => {})
}

// Absolute, because the widget runs on a different origin than the API.
export function logoUrl(clientId: string): string {
  const base = process.env.API_PUBLIC_URL ?? 'http://localhost:3001'
  return `${base}/widget-config/${clientId}/logo`
}
