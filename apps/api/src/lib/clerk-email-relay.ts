import { Webhook } from 'svix'
import { supabase } from './supabase'
import { sendGuardedEmail } from './notify'

// Relays Clerk system emails (org invitations, etc.) through our own platform
// Gmail sender instead of Clerk's SendGrid, for any Clerk email template
// where "Delivered by Clerk" has been turned off in the Clerk dashboard.
//
// Clerk's own docs are explicit about the contract: turning that toggle off
// means "Clerk will not send this email and you must listen to the
// email.created webhook to send it on your own." This module IS that
// listener. The dashboard toggle is the single source of truth for which
// email types get relayed — nothing here hardcodes a slug allowlist, so
// flipping another template's toggle later just works without a code change.
//
// Clerk hands us the email fully rendered (subject/body/body_plain with every
// {{app.name}}-style variable already substituted) — we don't reconstruct or
// re-template anything, just resend the same content from a different sender.

// Shape confirmed directly from @clerk/backend's own shipped type
// definitions (dist/api/resources/{JSON,Webhooks}.d.ts), not from docs —
// Clerk's public webhook-event docs don't cover the email.created payload.
interface ClerkEmailJSON {
  object: 'email'
  id: string
  slug?: string | null
  from_email_name: string
  to_email_address?: string
  email_address_id: string | null
  user_id?: string | null
  subject?: string
  body?: string
  body_plain?: string | null
  status?: string
  data?: Record<string, unknown> | null
  delivered_by_clerk: boolean
}

interface ClerkWebhookEvent {
  type: string
  object: 'event'
  data: unknown
}

export function clerkWebhookConfigured(): boolean {
  return !!process.env.CLERK_WEBHOOK_SECRET
}

// Verifies the Svix signature and returns the parsed event, or null if the
// signature is invalid/missing/not configured. `rawBody` must be the exact
// bytes Clerk sent — see the express.raw() registration in index.ts.
function verify(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): ClerkWebhookEvent | null {
  const secret = process.env.CLERK_WEBHOOK_SECRET
  if (!secret) { console.warn('[clerk-relay] CLERK_WEBHOOK_SECRET not set — webhook ignored'); return null }

  const svixHeaders = {
    'svix-id': headers['svix-id'],
    'svix-timestamp': headers['svix-timestamp'],
    'svix-signature': headers['svix-signature']
  } as Record<string, string>

  try {
    return new Webhook(secret).verify(rawBody, svixHeaders) as ClerkWebhookEvent
  } catch (err) {
    console.error('[clerk-relay] signature verification failed', err instanceof Error ? err.message : err)
    return null
  }
}

// Svix retries on anything but a 2xx, so the same event can arrive more than
// once — dedupe on Clerk's own email id before sending. Reuses
// notification_log (already the send-history table) rather than a new one;
// the small check-then-insert race mirrors this file's existing daily-cap
// check, which is the precedent this codebase already accepts for this class
// of guard.
async function alreadyRelayed(clerkEmailId: string): Promise<boolean> {
  const { count } = await supabase
    .from('notification_log')
    .select('*', { count: 'exact', head: true })
    .eq('event', `clerk_email:${clerkEmailId}`)
  return (count ?? 0) > 0
}

// Processes one verified webhook payload. Returns a short status string for
// logging; never throws — a malformed or unexpected event is a no-op, not a
// 500, so Clerk doesn't retry-storm on something that will never succeed.
export async function relayClerkEmail(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<string> {
  const event = verify(rawBody, headers)
  if (!event) return 'invalid_signature'
  if (event.type !== 'email.created') return 'ignored_event_type'

  const email = event.data as ClerkEmailJSON
  // Clerk still fires this event when IT sent the email (informational) —
  // only act when delivery was explicitly left to us.
  if (email.delivered_by_clerk) return 'delivered_by_clerk_noop'
  if (!email.to_email_address || !email.subject) return 'missing_fields'

  if (await alreadyRelayed(email.id)) return 'duplicate_skipped'

  const result = await sendGuardedEmail({
    clientId: null, // platform-level, not attributed to any client
    event: `clerk_email:${email.id}`,
    to: email.to_email_address,
    subject: email.subject,
    body: email.body_plain ?? email.body ?? '(no content)',
    html: email.body ?? undefined,
    // Clerk's own configured local-part (e.g. "invitations") reads better as
    // a display name than the raw connected Gmail address.
    fromName: email.from_email_name || 'Hyperbole Digital'
  })

  return result.sent ? 'relayed' : `skipped_${result.reason ?? 'unknown'}`
}
