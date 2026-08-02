import { randomBytes } from 'crypto'
import { supabase } from './supabase'

// The shareable page a prospect opens. They have no login, so preview_token
// (~192 bits) is the only credential — treat the page as fully public and put
// nothing on it beyond the mockup, the audit summary, and a booking CTA.
//
// This does NOT send anything. The operator copies the link into the email
// they send themselves, exactly as they already do with the CSV drafts.

export interface ProspectPreview {
  id: string
  prospectId: string
  mockupId: string | null
  crawlId: string | null
  previewToken: string
  expiresAt: string | null
  revokedAt: string | null
  viewCount: number
  firstViewedAt: string | null
  lastViewedAt: string | null
  createdAt: string
}

interface Row {
  id: string
  prospect_id: string
  mockup_id: string | null
  crawl_id: string | null
  preview_token: string
  expires_at: string | null
  revoked_at: string | null
  view_count: number
  first_viewed_at: string | null
  last_viewed_at: string | null
  created_at: string
}

function fromRow(r: Row): ProspectPreview {
  return {
    id: r.id,
    prospectId: r.prospect_id,
    mockupId: r.mockup_id,
    crawlId: r.crawl_id,
    previewToken: r.preview_token,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    viewCount: r.view_count,
    firstViewedAt: r.first_viewed_at,
    lastViewedAt: r.last_viewed_at,
    createdAt: r.created_at
  }
}

export function previewUrl(token: string): string {
  const base = process.env.API_PUBLIC_URL ?? 'http://localhost:3001'
  return `${base}/p/${token}`
}

export async function createPreview(
  prospectId: string,
  opts: { mockupId?: string | null; crawlId?: string | null } = {}
): Promise<ProspectPreview> {
  const { data, error } = await supabase
    .from('prospect_previews')
    .insert({
      prospect_id: prospectId,
      mockup_id: opts.mockupId ?? null,
      crawl_id: opts.crawlId ?? null,
      preview_token: randomBytes(24).toString('base64url')
    })
    .select()
    .single()
  if (error) throw new Error(`Failed to create preview: ${error.message}`)
  return fromRow(data as Row)
}

export async function listPreviews(prospectId: string): Promise<ProspectPreview[]> {
  const { data, error } = await supabase
    .from('prospect_previews')
    .select('*')
    .eq('prospect_id', prospectId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`Failed to list previews: ${error.message}`)
  return ((data ?? []) as Row[]).map(fromRow)
}

export async function getPreviewByToken(token: string): Promise<ProspectPreview | null> {
  const { data, error } = await supabase
    .from('prospect_previews')
    .select('*')
    .eq('preview_token', token)
    .maybeSingle()
  if (error) { console.error('[prospect-previews] lookup failed', error.message); return null }
  return data ? fromRow(data as Row) : null
}

export async function revokePreview(id: string): Promise<ProspectPreview> {
  const { data, error } = await supabase
    .from('prospect_previews')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) throw new Error(`Failed to revoke preview: ${error.message}`)
  return fromRow(data as Row)
}

export function isPreviewActive(preview: ProspectPreview): boolean {
  if (preview.revokedAt) return false
  if (preview.expiresAt && new Date(preview.expiresAt).getTime() < Date.now()) return false
  return true
}

// Fire-and-forget from the public route — a counter write must never be able
// to 500 the page the prospect is looking at.
export async function recordView(id: string): Promise<void> {
  const { data } = await supabase
    .from('prospect_previews')
    .select('view_count, first_viewed_at')
    .eq('id', id)
    .maybeSingle()
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('prospect_previews')
    .update({
      view_count: (data?.view_count ?? 0) + 1,
      first_viewed_at: data?.first_viewed_at ?? now,
      last_viewed_at: now
    })
    .eq('id', id)
  if (error) console.error('[prospect-previews] failed to record view', error.message)
}
