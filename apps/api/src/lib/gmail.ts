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

// Sends a standalone email from the client's connected Gmail. Used for
// escalation notices to a human. No-op-safe: throws if not connected, callers
// decide how to degrade.
export async function sendPlainEmail(
  clientId: string,
  to: string,
  subject: string,
  body: string,
  extraHeaders: Record<string, string> = {}
): Promise<void> {
  const conn = await connect(clientId)
  if (!conn) throw new Error(`No Gmail connection for client ${clientId}`)

  const headerLines = [
    `From: ${headerSafe(conn.email)}`,
    `To: ${headerSafe(to)}`,
    `Subject: ${encodeHeaderValue(headerSafe(subject))}`,
    `${STAMP_HEADER}: escalation`,
    ...Object.entries(extraHeaders).map(([k, v]) => `${headerSafe(k)}: ${headerSafe(v)}`),
    'Content-Type: text/plain; charset="UTF-8"'
  ]
  // Body is NOT header-sanitized (newlines are fine in the body), but it comes
  // after the blank line so it can't inject headers regardless.
  const raw = Buffer.from([...headerLines, '', body].join('\r\n')).toString('base64url')

  const gmail = google.gmail({ version: 'v1', auth: conn.client })
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } })
}

export async function gmailConnected(clientId: string): Promise<boolean> {
  return (await connect(clientId)) !== null
}
