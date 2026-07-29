import * as tls from 'node:tls'
import * as https from 'node:https'
import * as dns from 'node:dns/promises'
import { supabase } from './supabase'

// "Site Health" — the Care tier's baseline promise (every client, no add-on
// gate): is the site up, and is its SSL certificate valid and not about to
// expire. Deliberately on-demand (fetched live when the dashboard loads or the
// client clicks "Check now"), not a scheduled poller — this platform has no
// scheduler by design (see TODO.md), so this is a point-in-time snapshot, not
// continuous uptime monitoring.
//
// Behaves like a browser, NOT like a single naive fetch: it resolves EVERY A/
// AAAA record for the host and probes each one, reporting "up" if any address
// serves the site and reading SSL from an address that actually completes a
// handshake. A one-shot `fetch()` pins whatever address the OS hands back and
// would call the site Down the moment it landed on a dead one — e.g. a domain
// with the real host's records AND leftover GoDaddy domain-forwarding IPs
// (which fail TLS), where a browser silently fails over but a naive checker
// cries wolf. That false alarm is the bug this replaced.

export interface SiteHealthResult {
  up: boolean
  statusCode: number | null
  responseTimeMs: number | null
  error: string | null
  ssl: {
    valid: boolean
    issuer: string | null
    expiresAt: string | null
    daysRemaining: number | null
  } | null // null when there's no cert data — see sslError for why
  // Set only when the TLS check itself failed (connection error, timeout,
  // handshake rejected) — distinct from `ssl === null` meaning "genuinely no
  // HTTPS listener." Both used to collapse to the same "Not served over
  // HTTPS" message, which is wrong (and misleading) when the site does serve
  // HTTPS but the specific check attempt errored — e.g. a stale DNS record
  // round-robining some requests to a dead host that fails the handshake.
  sslError: string | null
}

export interface SiteHealthRow extends SiteHealthResult {
  id: string
  clientId: string
  checkedAt: string
}

function normalizeHost(rawDomain: string): string {
  return rawDomain.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim()
}

// Every A/AAAA record for the host, so we can probe each the way a browser
// tries them. Falls back to the bare host (let the OS resolve at connect time)
// if resolution returns nothing — e.g. a CNAME-flattened host.
async function resolveAddresses(host: string): Promise<string[]> {
  const settled = await Promise.allSettled([dns.resolve4(host), dns.resolve6(host)])
  const addrs = settled.flatMap(r => (r.status === 'fulfilled' ? r.value : []))
  return addrs.length ? addrs : [host]
}

interface Probe {
  ok: boolean
  statusCode: number | null
  responseTimeMs: number | null
  error: string | null
  ssl: SiteHealthResult['ssl']
  sslError: string | null
}

// One HTTPS request pinned to a specific address (SNI + Host set to the real
// host so shared-IP/CDN vhosts and cert selection resolve correctly). A
// redirect (3xx) counts as "up" — an apex that 301s to www is still a live
// site, which is exactly how a browser treats it.
function httpAt(addr: string, host: string, timeoutMs = 8000): Promise<{ ok: boolean; statusCode: number | null; responseTimeMs: number | null; error: string | null }> {
  return new Promise(resolve => {
    const start = Date.now()
    const req = https.request(
      { host: addr, servername: host, port: 443, method: 'GET', path: '/', timeout: timeoutMs, headers: { Host: host, 'User-Agent': 'HyperboleSiteHealth/1.0' } },
      res => {
        const status = res.statusCode ?? null
        res.resume() // drain so the socket can close
        const ok = status !== null && status < 400
        resolve({ ok, statusCode: status, responseTimeMs: Date.now() - start, error: ok ? null : `HTTP ${status}` })
      }
    )
    req.once('error', e => resolve({ ok: false, statusCode: null, responseTimeMs: null, error: e.message }))
    req.once('timeout', () => { req.destroy(); resolve({ ok: false, statusCode: null, responseTimeMs: null, error: 'request timed out' }) })
    req.end()
  })
}

// Raw TLS handshake against a specific address (Fetch/https can't hand back the
// peer certificate) to read the cert's validity window. `servername` drives SNI.
function sslAt(addr: string, host: string, timeoutMs = 8000): Promise<{ ssl: SiteHealthResult['ssl']; sslError: string | null }> {
  return new Promise(resolve => {
    const socket = tls.connect({ host: addr, port: 443, servername: host, timeout: timeoutMs }, () => {
      const cert = socket.getPeerCertificate()
      socket.end()
      if (!cert || !cert.valid_to) {
        resolve({ ssl: { valid: false, issuer: null, expiresAt: null, daysRemaining: null }, sslError: null })
        return
      }
      const expiresAt = new Date(cert.valid_to)
      const daysRemaining = Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000)
      const issuerRaw = cert.issuer?.O ?? cert.issuer?.CN ?? null
      resolve({
        ssl: {
          valid: socket.authorized && daysRemaining >= 0,
          issuer: Array.isArray(issuerRaw) ? issuerRaw[0] ?? null : issuerRaw,
          expiresAt: expiresAt.toISOString(),
          daysRemaining
        },
        sslError: null
      })
    })
    socket.once('error', (e: Error) => { socket.destroy(); resolve({ ssl: null, sslError: e.message || 'TLS connection failed' }) })
    socket.once('timeout', () => { socket.destroy(); resolve({ ssl: null, sslError: 'TLS handshake timed out' }) })
  })
}

export async function checkSiteHealth(rawDomain: string): Promise<SiteHealthResult> {
  const host = normalizeHost(rawDomain)
  const addresses = await resolveAddresses(host)

  const probes: Probe[] = await Promise.all(
    addresses.map(async addr => {
      const [http, ssl] = await Promise.all([httpAt(addr, host), sslAt(addr, host)])
      return { ...http, ...ssl }
    })
  )

  // Browser-like verdict: up if ANY address serves the site; report timing from
  // a working address, and SSL from an address that actually returned a cert.
  // Only when NO address works do we surface the failure.
  const upProbe = probes.find(p => p.ok)
  const httpFallback = upProbe ?? probes[0]
  const sslProbe = probes.find(p => p.ssl) ?? probes[0]

  return {
    up: !!upProbe,
    statusCode: httpFallback.statusCode,
    responseTimeMs: httpFallback.responseTimeMs,
    error: upProbe ? null : httpFallback.error,
    ssl: sslProbe.ssl,
    sslError: sslProbe.ssl ? null : sslProbe.sslError
  }
}

interface Row {
  id: string
  client_id: string
  checked_at: string
  up: boolean
  status_code: number | null
  response_time_ms: number | null
  error: string | null
  ssl_valid: boolean | null
  ssl_issuer: string | null
  ssl_expires_at: string | null
  ssl_days_remaining: number | null
  ssl_error: string | null
}

function fromRow(row: Row): SiteHealthRow {
  return {
    id: row.id,
    clientId: row.client_id,
    checkedAt: row.checked_at,
    up: row.up,
    statusCode: row.status_code,
    responseTimeMs: row.response_time_ms,
    error: row.error,
    ssl: row.ssl_valid === null
      ? null
      : { valid: row.ssl_valid, issuer: row.ssl_issuer, expiresAt: row.ssl_expires_at, daysRemaining: row.ssl_days_remaining },
    sslError: row.ssl_error
  }
}

export async function getLatestSiteHealth(clientId: string): Promise<SiteHealthRow | null> {
  const { data } = await supabase
    .from('site_health_checks')
    .select('*')
    .eq('client_id', clientId)
    .order('checked_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? fromRow(data as Row) : null
}

// Runs a fresh check and persists it. Callers should debounce (see the route —
// skip re-checking if the latest row is under a minute old) since this is
// reachable by any client on every page load, not just superadmin.
export async function recordSiteHealthCheck(clientId: string, domain: string): Promise<SiteHealthRow> {
  const result = await checkSiteHealth(domain)
  const { data, error } = await supabase
    .from('site_health_checks')
    .insert({
      client_id: clientId,
      up: result.up,
      status_code: result.statusCode,
      response_time_ms: result.responseTimeMs,
      error: result.error,
      ssl_valid: result.ssl?.valid ?? null,
      ssl_issuer: result.ssl?.issuer ?? null,
      ssl_expires_at: result.ssl?.expiresAt ?? null,
      ssl_days_remaining: result.ssl?.daysRemaining ?? null,
      ssl_error: result.sslError
    })
    .select('*')
    .single()
  if (error) throw new Error(`failed to record site health check: ${error.message}`)
  return fromRow(data as Row)
}
