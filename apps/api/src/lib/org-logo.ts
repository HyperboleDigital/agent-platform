import { randomUUID } from 'crypto'
import { supabase } from './supabase'

// Internal-dashboard-only org logo (shown next to the client name in the app
// shell breadcrumb). Deliberately separate from apps/api/src/lib/widget-logo.ts,
// which serves the PUBLIC chat-widget logo to anonymous website visitors —
// different audience, different bucket, different (authenticated) access path.
const BUCKET = 'org-logos'
const SIGNED_URL_TTL_SECONDS = 5 * 60

export const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif']
export const MAX_LOGO_BYTES = 1 * 1024 * 1024 // 1MB

export async function uploadOrgLogo(clientId: string, contentType: string, buffer: Buffer): Promise<string> {
  const storagePath = `${clientId}/${randomUUID()}`
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, { contentType, upsert: false })
  if (error) throw error
  return storagePath
}

export async function deleteOrgLogo(storagePath: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([storagePath])
  if (error) console.error('[org-logo] failed to delete storage object', error.message)
}

// Short-lived signed URL — recomputed on every client read rather than stored,
// same tradeoff as knowledge-files.ts/attachments.ts. Fine here: the dashboard
// re-fetches the client object regularly, and this is admin chrome, not
// something a page sits on for hours unattended.
export async function getOrgLogoUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
  if (error) { console.error('[org-logo] failed to sign url', error.message); return null }
  return data.signedUrl
}
