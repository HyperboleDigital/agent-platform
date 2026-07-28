// ─── Shared types across API, dashboard, and widget ──────────────────────────

export type Channel = 'chat' | 'email'
export type Intent = 'faq' | 'booking' | 'lead' | 'escalate' | 'unknown'

export interface IncomingMessage {
  clientId: string
  channel: Channel
  from: string
  body: string
  threadId?: string
  metadata?: Record<string, string>
}

export interface AgentResponse {
  intent: Intent
  reply: string
  action: 'send_reply' | 'book_call' | 'escalate' | 'capture_lead' | 'show_contact_form' | 'none'
  escalate: boolean
  captureLead: boolean
  confidence: number
  metadata?: Record<string, unknown>
}

export type Vertical = 'local' | 'b2b'

// A client's `domain` is the one persistent website URL used across the
// platform — Site Health (uptime/SSL), the SEO audit crawl target, and the
// Search Console default. Shared here (not duplicated in the API and the
// dashboard) so "what counts as a real, checkable domain" can't drift between
// the server-side save validation, the crawler's target normalization, and the
// dashboard's inline form feedback.
export function normalizeDomain(input: string): string {
  return input.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim().toLowerCase()
}

export function isPublicHost(host: string): boolean {
  const h = host.toLowerCase()
  if (!h || !h.includes('.')) return false // no TLD, e.g. "localhost"
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.localhost')) return false
  if (h === '::1' || h === '0.0.0.0') return false
  if (/^(127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(h)) return false
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false // 172.16.0.0–172.31.255.255
  return true
}

export interface Client {
  id: string
  name: string
  domain: string
  industry: string
  active: boolean
  agentConfig: AgentConfig
  createdAt: string
  clerkOrgId?: string | null   // Clerk Organization that owns this client (tenant boundary)
  portalConfig: PortalConfig
  vertical: Vertical | null    // which pricing-sheet ladder this client is on
  tierKey: string | null       // key into lib/tiers.ts's TIER catalog
}

// SEO/portal soft config — audit target pages, brand terms for AI-visibility
// mention matching, and the connected Google Search Console property.
export interface PortalConfig {
  seoPages?: string[]
  brandTerms?: string[]
  gscProperty?: string // e.g. "sc-domain:example.com" or "https://example.com/"
  // Canonical NAP (name/address/phone) for local clients — the single source
  // of truth every directory listing is diffed against to catch drift.
  napName?: string
  napAddress?: string
  napPhone?: string
  // Google Place ID for the business — powers the auto-pulled reviews card
  // and is the anchor DataForSEO map-pack rank checks match against.
  placeId?: string
  // Keywords to check the business's Google Maps 3-pack position for, e.g.
  // "plumber", checked from `localLocation`.
  localKeywords?: string[]
  // ISO timestamp of when the client finished (or skipped) first-login
  // onboarding. Unset = show the onboarding flow on their next visit.
  onboardedAt?: string
  // City/state DataForSEO should simulate the map search from, e.g.
  // "Austin,Texas,United States". Multiple = the business is tracked across
  // several cities; every map-pack keyword is checked from each.
  localLocations?: string[]
  // Legacy single-location field, superseded by localLocations. Kept so old
  // records still resolve a location; new writes go to localLocations.
  localLocation?: string
}

export interface AgentConfig {
  systemPromptExtra?: string
  knowledgeBaseIds: string[]
  calendlyLink?: string
  slackWebhook?: string
  escalationEmail?: string   // where human-needed items (escalations, contact form) are sent
  autoSendThreshold: number
  emailDraft: boolean
}

export type LeadStatus = 'new' | 'followed_up'

export interface Lead {
  id: string
  clientId: string
  name?: string
  email: string
  intent: string
  summary: string
  channel: Channel
  status: LeadStatus
  createdAt: string
}

export interface Escalation {
  id: string
  clientId: string
  from: string
  body: string
  reason: string
  status: 'open' | 'resolved'
  createdAt: string
}

export interface MessageLog {
  id: string
  clientId: string
  channel: Channel
  intent: Intent
  resolved: boolean
  durationMs: number
  createdAt: string
}
