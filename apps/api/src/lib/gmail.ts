import { randomBytes } from 'crypto'
import { google } from 'googleapis'
import { supabase } from './supabase'
import { encryptSecret, decryptSecret } from './crypto'

// Strips CR/LF (and stray control chars) from a value destined for an email
// header, so caller-supplied fields (subject, recipient) can't inject extra
// headers like Bcc. This is the fix for the CRLF header-injection vector.
export function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/[\x00-\x1f\x7f]/g, '').trim()
}

// Raw email headers are ASCII-only; non-ASCII text (em dashes, names with
// accents, emoji, etc.) needs RFC 2047 encoded-word encoding or it renders as
// mojibake in the recipient's client. ASCII-only values pass through untouched.
export function encodeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

// Send-only + identity. Deliberately NOT gmail.modify/readonly — the platform
// never reads a connected inbox (inbound answering is out of scope), so the
// grant can't either. Least privilege by design.
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'openid',
  'https://www.googleapis.com/auth/userinfo.email'
]

const STAMP_HEADER = 'X-Agent-Platform'

export function gmailConfigured(): boolean {
  return !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REDIRECT_URI)
}

function oauthClient() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI
  )
}

// Consent URL. `state` carries the clientId back to the callback.
export function getAuthUrl(clientId: string): string {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // force a refresh token even on re-consent
    scope: SCOPES,
    state: clientId
  })
}

// The platform's OWN sender (see platform_gmail_token) — not any client's.
// `state: 'platform'` is a reserved sentinel; no client id can ever equal it
// (Postgres uuids never collide with a plain word), so routes/auth.ts's
// callback can tell the two apart with a simple string check.
export const PLATFORM_STATE = 'platform'

export function getPlatformAuthUrl(): string {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state: PLATFORM_STATE
  })
}

async function emailFromCredentials(client: ReturnType<typeof oauthClient>): Promise<string> {
  const oauth2 = google.oauth2({ version: 'v2', auth: client })
  const me = await oauth2.userinfo.get()
  return me.data.email ?? 'unknown'
}

// Exchange the auth code, look up the connected address, and persist the token.
export async function handleCallback(clientId: string, code: string): Promise<string> {
  const client = oauthClient()
  const { tokens } = await client.getToken(code)
  if (!tokens.refresh_token) {
    throw new Error('No refresh token returned — revoke access and retry with prompt=consent.')
  }
  client.setCredentials(tokens)
  const email = await emailFromCredentials(client)

  await supabase.from('gmail_tokens').upsert({
    client_id: clientId,
    email,
    refresh_token: encryptSecret(tokens.refresh_token),
    updated_at: new Date().toISOString()
  })

  return email
}

async function connect(clientId: string): Promise<{ email: string; client: ReturnType<typeof oauthClient> } | null> {
  const { data } = await supabase
    .from('gmail_tokens')
    .select('email, refresh_token')
    .eq('client_id', clientId)
    .single()
  if (!data) return null

  const client = oauthClient()
  client.setCredentials({ refresh_token: decryptSecret(data.refresh_token as string) })
  return { email: data.email as string, client }
}

// Exchanges the auth code for the PLATFORM's own connection (see
// getPlatformAuthUrl above) and persists it as the singleton row.
export async function handlePlatformCallback(code: string): Promise<string> {
  const client = oauthClient()
  const { tokens } = await client.getToken(code)
  if (!tokens.refresh_token) {
    throw new Error('No refresh token returned — revoke access and retry with prompt=consent.')
  }
  client.setCredentials(tokens)
  const email = await emailFromCredentials(client)

  await supabase.from('platform_gmail_token').upsert({
    id: true,
    email,
    refresh_token: encryptSecret(tokens.refresh_token),
    updated_at: new Date().toISOString()
  })

  return email
}

async function connectPlatform(): Promise<{ email: string; client: ReturnType<typeof oauthClient> } | null> {
  const { data } = await supabase
    .from('platform_gmail_token')
    .select('email, refresh_token')
    .eq('id', true)
    .maybeSingle()
  if (!data) return null

  const client = oauthClient()
  client.setCredentials({ refresh_token: decryptSecret(data.refresh_token as string) })
  return { email: data.email as string, client }
}

export interface GmailStatus {
  connected: boolean
  email?: string
  connectedAt?: string
  status: 'ok' | 'error' | 'not_connected'
  error?: string
}

// Live health check — validates the stored refresh token by exchanging it for
// an access token (no Gmail API call needed, works under send-only scope).
export async function checkGmailStatus(clientId: string): Promise<GmailStatus> {
  const { data } = await supabase
    .from('gmail_tokens')
    .select('email, refresh_token, created_at')
    .eq('client_id', clientId)
    .single()

  if (!data) return { connected: false, status: 'not_connected' }

  try {
    const client = oauthClient()
    client.setCredentials({ refresh_token: decryptSecret(data.refresh_token as string) })
    await client.getAccessToken() // throws if the grant is revoked/expired
    return { connected: true, email: data.email as string, connectedAt: data.created_at as string, status: 'ok' }
  } catch (err: any) {
    return {
      connected: true,
      email: data.email as string,
      connectedAt: data.created_at as string,
      status: 'error',
      error: err?.message ?? 'Token invalid or revoked'
    }
  }
}

// Removes the stored refresh token — escalations fall back to Slack-only
// until the client reconnects (or connects a different account).
export async function disconnectGmail(clientId: string): Promise<void> {
  const { error } = await supabase.from('gmail_tokens').delete().eq('client_id', clientId)
  if (error) throw error
}

// Same health check as checkGmailStatus, for the platform's own connection.
export async function checkPlatformGmailStatus(): Promise<GmailStatus> {
  const { data } = await supabase
    .from('platform_gmail_token')
    .select('email, refresh_token, created_at')
    .eq('id', true)
    .maybeSingle()

  if (!data) return { connected: false, status: 'not_connected' }

  try {
    const client = oauthClient()
    client.setCredentials({ refresh_token: decryptSecret(data.refresh_token as string) })
    await client.getAccessToken()
    return { connected: true, email: data.email as string, connectedAt: data.created_at as string, status: 'ok' }
  } catch (err: any) {
    return {
      connected: true,
      email: data.email as string,
      connectedAt: data.created_at as string,
      status: 'error',
      error: err?.message ?? 'Token invalid or revoked'
    }
  }
}

// Removes the platform's own connection — every platform-sent email
// (Clerk-relayed system emails, reports, change-request notifications) is
// skipped, not routed to any client's Gmail, until reconnected.
export async function disconnectPlatformGmail(): Promise<void> {
  const { error } = await supabase.from('platform_gmail_token').delete().eq('id', true)
  if (error) throw error
}

export interface SendEmailOptions {
  // Display name on the From line, e.g. "Spec-ID Assistant" — the address
  // itself is always the connected Gmail account (Gmail refuses to send as an
  // arbitrary address; only the authenticated account or a verified alias).
  fromName?: string
  // Where a human's "Reply" actually goes. For a lead this is the visitor's
  // own address, so the salesperson replies straight to the prospect instead
  // of to their own inbox.
  replyTo?: string
  // When present the message is sent as multipart/alternative: this HTML plus
  // `body` as the plain-text fallback, so clients that block HTML (and
  // notification previews) still read correctly.
  html?: string
  extraHeaders?: Record<string, string>
  // Files to attach (multipart/mixed). `contentBase64` is plain base64 — no
  // data: URI prefix. Callers are responsible for size sanity; Gmail rejects
  // messages over 25MB total.
  attachments?: EmailAttachment[]
}

export interface EmailAttachment {
  filename: string
  contentType: string   // e.g. "application/pdf"
  contentBase64: string
}

// Shared MIME-building + send, given an already-resolved connection — the
// only difference between a client's own send (sendPlainEmail) and the
// platform's (sendPlatformEmail) is which connection gets resolved, so this
// is the one place that logic can't drift between the two.
async function sendViaConnection(
  conn: { email: string; client: ReturnType<typeof oauthClient> },
  to: string,
  subject: string,
  body: string,
  optionsOrHeaders: SendEmailOptions | Record<string, string> = {}
): Promise<void> {
  // Back-compat: this used to take a bare extraHeaders map as the 5th arg.
  const isOptions = ['fromName', 'replyTo', 'html', 'extraHeaders', 'attachments']
    .some(k => k in optionsOrHeaders)
  const options: SendEmailOptions = isOptions
    ? optionsOrHeaders as SendEmailOptions
    : { extraHeaders: optionsOrHeaders as Record<string, string> }

  // A display name containing a comma/quote would break the address list, so
  // it's quoted with inner quotes stripped, then RFC-2047 encoded if non-ASCII.
  const from = options.fromName
    ? `${encodeHeaderValue(`"${headerSafe(options.fromName).replace(/"/g, '')}"`)} <${headerSafe(conn.email)}>`
    : headerSafe(conn.email)

  const headerLines = [
    `From: ${from}`,
    `To: ${headerSafe(to)}`,
    ...(options.replyTo ? [`Reply-To: ${headerSafe(options.replyTo)}`] : []),
    `Subject: ${encodeHeaderValue(headerSafe(subject))}`,
    `${STAMP_HEADER}: escalation`,
    ...Object.entries(options.extraHeaders ?? {}).map(([k, v]) => `${headerSafe(k)}: ${headerSafe(v)}`)
  ]

  // Bodies are NOT header-sanitized (newlines are fine there) but always sit
  // after the blank line, so they can't inject headers regardless.
  //
  // The text/html content is built headerless first so it can sit either at
  // the top level (no attachments) or as the first part of a multipart/mixed
  // envelope (with attachments).
  let contentLines: string[]
  if (options.html) {
    // Boundary is random so body text can never accidentally contain it.
    const boundary = `==_ap_${randomBytes(12).toString('hex')}`
    contentLines = [
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      '',
      body,
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      '',
      options.html,
      `--${boundary}--`
    ]
  } else {
    contentLines = ['Content-Type: text/plain; charset="UTF-8"', '', body]
  }

  let mime: string
  if (options.attachments?.length) {
    const mixed = `==_ap_mix_${randomBytes(12).toString('hex')}`
    const lines = [
      ...headerLines,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${mixed}"`,
      '',
      `--${mixed}`,
      ...contentLines
    ]
    for (const att of options.attachments) {
      // Filename lands inside a quoted header parameter — quotes stripped on
      // top of the usual CRLF sanitization so it can't break out.
      const filename = headerSafe(att.filename).replace(/"/g, '')
      lines.push(
        `--${mixed}`,
        `Content-Type: ${headerSafe(att.contentType)}; name="${filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${filename}"`,
        '',
        // RFC 2045 caps encoded lines at 76 chars.
        att.contentBase64.replace(/\s+/g, '').match(/.{1,76}/g)?.join('\r\n') ?? ''
      )
    }
    lines.push(`--${mixed}--`)
    mime = lines.join('\r\n')
  } else {
    mime = options.html
      ? [...headerLines, 'MIME-Version: 1.0', ...contentLines].join('\r\n')
      : [...headerLines, ...contentLines].join('\r\n')
  }

  const gmail = google.gmail({ version: 'v1', auth: conn.client })
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: Buffer.from(mime).toString('base64url') } })
}

// Sends a standalone email from the client's connected Gmail. Used for
// escalation/lead notices to a human. No-op-safe: throws if not connected,
// callers decide how to degrade.
export async function sendPlainEmail(
  clientId: string,
  to: string,
  subject: string,
  body: string,
  options: SendEmailOptions | Record<string, string> = {}
): Promise<void> {
  const conn = await connect(clientId)
  if (!conn) throw new Error(`No Gmail connection for client ${clientId}`)
  await sendViaConnection(conn, to, subject, body, options)
}

// Sends from the PLATFORM's own Gmail (see platform_gmail_token) — used for
// every platform-sent email: Clerk-relayed system emails, reports,
// change-request notifications. Never a client's own inbox. No-op-safe:
// throws if not connected, callers (sendGuardedEmail) decide how to degrade.
export async function sendPlatformEmail(
  to: string,
  subject: string,
  body: string,
  options: SendEmailOptions | Record<string, string> = {}
): Promise<void> {
  const conn = await connectPlatform()
  if (!conn) throw new Error('No platform Gmail connection — connect one from Overview')
  await sendViaConnection(conn, to, subject, body, options)
}

export async function gmailConnected(clientId: string): Promise<boolean> {
  return (await connect(clientId)) !== null
}

export async function platformGmailConnected(): Promise<boolean> {
  return (await connectPlatform()) !== null
}
