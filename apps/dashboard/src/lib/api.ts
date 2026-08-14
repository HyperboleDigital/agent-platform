import type { Client, Lead, LeadStatus } from '@agent-platform/shared'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

// Set once by <AuthBridge/> (mounted inside <ClerkProvider>) so plain fetch
// calls here can attach a fresh session token per request. No static secret
// ever lives in this bundle — see AuthBridge.tsx.
let getToken: ((opts?: { skipCache?: boolean }) => Promise<string | null>) | null = null
export function setTokenGetter(fn: (opts?: { skipCache?: boolean }) => Promise<string | null>) {
  getToken = fn
}

// Set once by <AuthBridge/> — called when a request comes back 401 even after
// a forced-fresh token, meaning the session itself (not just Clerk's local
// cache) is gone. Signs the user out so <ProtectedLayout/> redirects to
// sign-in, instead of the app sitting on a permanently-broken "can't reach
// the API" error until someone manually refreshes.
let onSessionExpired: (() => Promise<void>) | null = null
let signingOut = false
export function setSessionExpiredHandler(fn: () => Promise<void>) {
  onSessionExpired = fn
}

async function authHeaders(fresh = false): Promise<Record<string, string>> {
  const token = getToken ? await getToken(fresh ? { skipCache: true } : undefined) : null
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function rawFetch(path: string, options: RequestInit | undefined, fresh: boolean): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders(fresh)),
      ...options?.headers
    }
  })
}

async function toResult<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `API error: ${res.status}`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch { /* response wasn't JSON — keep the generic message */ }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let res = await rawFetch(path, options, false)
  // Clerk caches session tokens client-side; a stale one reads as 401 here
  // even while the underlying session is still valid. Retry once with a
  // forced-fresh token before concluding the session is actually gone —
  // that's the difference between "briefly stale" and "log back in".
  if (res.status === 401 && getToken) {
    res = await rawFetch(path, options, true)
  }
  if (res.status === 401 && onSessionExpired && !signingOut) {
    signingOut = true
    try {
      await onSessionExpired()
    } finally {
      signingOut = false
    }
  }
  return toResult<T>(res)
}

// Raw, unauthenticated connectivity check — used by the app shell to
// distinguish "API is down" from "user is logged out" (Clerk is a separate
// service, so it stays up even when our backend doesn't).
export async function checkHealth(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)
    const res = await fetch(`${BASE}/health`, { signal: controller.signal })
    clearTimeout(timeout)
    return res.ok
  } catch {
    return false
  }
}

export interface DashboardStats {
  messagesThisWeek: number
  leadsThisWeek: number
  openEscalations: number
  resolvedRate: number
  totalConversations: number
  totalLeadsCaptured: number
  questionsAnswered: number
  estimatedHoursSaved: number
}

export interface KnowledgeDoc {
  id: string // document_id — groups every chunk from one upload/paste
  title: string
  url: string | null
  description: string | null
  fileId: string | null
  created_at: string
}

export interface KnowledgeFile {
  id: string
  filename: string
  contentType: string
  sizeBytes: number
  uploadedBy: string | null
  createdAt: string
}

export interface ConnectorStatus {
  gmail: {
    configured: boolean
    connected: boolean
    status: 'ok' | 'error' | 'not_connected' | 'not_configured'
    email?: string
    connectedAt?: string
    error?: string
  }
  slack: { configured: boolean }
  calendly: { configured: boolean }
}

export interface PlanInfo {
  key: string
  priceId: string
  name: string
  monthlyPriceCents: number
  conversationCap: number
}

export type CitationStatus = 'pending' | 'live' | 'inconsistent' | 'not_applicable'
export type GbpKind = 'post' | 'photo' | 'qa' | 'category' | 'other'

export interface Citation {
  id: string
  clientId: string
  directory: string
  listingUrl: string | null
  status: CitationStatus
  napName: string | null
  napAddress: string | null
  napPhone: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  napMatches: boolean | null
}

export interface CitationSummary {
  total: number
  live: number
  pending: number
  inconsistent: number
}

export interface GbpActivity {
  id: string
  clientId: string
  kind: GbpKind
  title: string
  url: string | null
  performedAt: string
  notes: string | null
  createdAt: string
}

export interface PlaceReview {
  authorName: string
  rating: number
  text: string | null
  relativeTime: string
  publishTime: string
}

export interface PlaceSummary {
  placeId: string
  name: string
  rating: number | null
  reviewCount: number
  mapsUrl: string | null
  reviews: PlaceReview[]
  fetchedAt: string
}

export interface MapRankResult {
  keyword: string
  location: string
  rankAbsolute: number | null
  checkedAt: string
}

export interface PlaceCandidate {
  placeId: string
  name: string
  address: string | null
}

export interface LocalConfig {
  placeId: string
  localKeywords: string[]
  localLocations: string[]
}

export interface TargetKeyword {
  id: string
  clientId: string
  keyword: string
  createdAt: string
  latestRank: number | null
  latestUrl: string | null
  latestCheckedAt: string | null
  trend: { checkedAt: string; rank: number | null }[]
}

export interface KeywordIdea {
  keyword: string
  searchVolume: number | null
  difficulty: number | null
  cpc: number | null
}

export interface TierFeature {
  text: string
  built: boolean
  section?: string
}

export interface TierInfo {
  key: string
  vertical: 'local' | 'b2b'
  name: string
  monthlyPriceCents: number
  includes: ServiceKey[]
  quotas: { pagesPerMonth: number; contentPiecesPerMonth: number }
  features: TierFeature[]
}

export interface SubscriptionInfo {
  id: string
  clientId: string
  stripeCustomerId: string
  stripeSubscriptionId: string | null
  stripePriceId: string | null
  status: string
  currentPeriodEnd: string | null
}

export interface ClientSubscriptionSummary {
  id: string
  priceId: string | null
  amountCents: number | null
  status: string
  created: string
  isTracked: boolean
}

export interface Identity {
  userId: string
  orgId: string | null
  orgRole: string | null
  isSuperadmin: boolean
}

export type TeamRole = 'org:admin' | 'org:member'

export interface TeamMember {
  id: string
  userId: string
  email: string | null
  name: string | null
  imageUrl: string | null
  role: TeamRole
  createdAt: string
}

export interface TeamInvitation {
  id: string
  email: string
  role: TeamRole
  createdAt: string
}

export interface Team {
  members: TeamMember[]
  invitations: TeamInvitation[]
  seatLimit: number
  seatsUsed: number
  canManage: boolean
  currentUserId: string
}


export interface DailyCount {
  date: string
  count: number
  resolved: number
}

// ── Chat analytics (client Insights tab) ─────────────────────────────────────
export interface HeadlineMetric {
  value: number
  previous: number
  changePct: number | null // null = no previous-period baseline
}
export interface Headline {
  conversations: HeadlineMetric
  leads: HeadlineMetric
  deflectionRate: HeadlineMetric     // 0..1
  afterHoursCoverage: HeadlineMetric // 0..1
}
export interface TrendPoint {
  date: string
  conversations: number
  leads: number
  escalations: number
}
export interface QuestionCluster {
  question: string
  count: number
  examples: string[]
}
export interface UnansweredEntry {
  createdAt: string
  sessionId: string | null
  question: string
  confidence: number | null
  reason: string | null
  resolvedBy: string | null
}
export interface CoverageEntry {
  documentId: string
  title: string
  retrievals: number
}
export interface AnalyticsQuery {
  range?: number    // days (7 | 30 | 90 …)
  from?: string     // ISO — used with `to` for a custom range
  to?: string
}

export interface MonthlyUsage {
  used: number
  cap: number
  planName: string | null
}

export interface OverviewSummary {
  mrrCents: number
  activeClients: number
  totalClients: number
  conversationsThisMonth: number
  clientsNearCap: number
}

export interface ClientRollup {
  clientId: string
  name: string
  active: boolean
  planName: string | null
  subscriptionStatus: string | null
  usage: { used: number; cap: number }
  mrrCents: number
  comped: boolean
  billingActive: boolean
}

export type ServiceKey = 'seo' | 'content' | 'reviews' | 'social' | 'local' | 'chat' | 'ads'

export interface ServiceInfo {
  key: ServiceKey
  priceId: string
  name: string
  monthlyPriceCents: number
  description: string
  status: 'available' | 'coming_soon' | 'tier_only'
}

export interface ServiceEntitlement {
  entitled: boolean
  source: 'addon' | 'comp' | 'tier' | null
  status: 'available' | 'coming_soon' | 'tier_only'
}

export interface Entitlements {
  active: boolean
  planKey: string | null
  services: Record<ServiceKey, ServiceEntitlement>
}

export interface SiteHealth {
  id: string
  clientId: string
  checkedAt: string
  up: boolean
  statusCode: number | null
  responseTimeMs: number | null
  error: string | null
  ssl: {
    valid: boolean
    issuer: string | null
    expiresAt: string | null
    daysRemaining: number | null
  } | null
  sslError: string | null
}

export interface PortalConfig {
  seoPages?: string[]
  brandTerms?: string[]
  gscProperty?: string
  placeId?: string
  localKeywords?: string[]
  localLocations?: string[]
  localLocation?: string
  onboardedAt?: string
}

export interface CrawlIssue {
  key?: string
  severity: 'high' | 'medium' | 'low'
  title: string
  count: number
  explanation: string
  urls?: string[]
}

export interface SeoCrawl {
  id: string
  clientId: string
  url: string
  status: 'running' | 'finished' | 'failed'
  taskId: string | null
  onpageScore: number | null
  pagesCrawled: number | null
  checks: { key: string; label: string; count: number; urls: string[] }[] | null
  issues: CrawlIssue[] | null
  aiSearch: {
    score: number
    hasLlmsTxt: boolean
    blockedBots: string[]
    sitemap: { found: boolean; url: string | null; urlCount: number | null; referencedInRobots: boolean }
    issues: { severity: 'high' | 'medium' | 'low'; title: string; detail: string }[]
  } | null
  cost: number | null
  error: string | null
  createdAt: string
  updatedAt: string
}

// One entry per finished audit, oldest→newest. Trimmed server-side: no `urls`
// on the checks, since the trend only ever needs counts.
export interface CrawlTrendPoint {
  id: string
  createdAt: string
  onpageScore: number | null
  aiSearchScore: number | null
  pagesCrawled: number | null
  checks: { key: string; label: string; count: number }[]
}

// ── Prospecting (cold-outreach engine, superadmin) ────────────────────────────
export type ProspectStatus =
  | 'new' | 'saved' | 'drafted' | 'sent' | 'replied' | 'won' | 'lost' | 'do_not_contact'

export interface ProspectCandidate {
  placeId: string
  name: string
  address: string | null
  phone: string | null
  website: string | null
  noWebsite: boolean
  rating: number | null
  reviewCount: number
  mapsUrl: string | null
}

export interface Prospect {
  id: string
  placeId: string | null
  name: string
  category: string | null
  groupName: string | null
  area: string | null
  phone: string | null
  email: string | null
  website: string | null
  noWebsite: boolean
  mapsUrl: string | null
  rating: number | null
  reviewCount: number | null
  status: ProspectStatus
  draftPlain: string | null
  draftLoom: string | null
  draftValue: string | null
  hookSource: string | null
  notes: string | null
  createdAt: string
}

export interface DiscoveryResult {
  count: number
  candidates: ProspectCandidate[]
  // Whether this came from the API's server-side cache instead of a real
  // (billed) Places call — same (category, area) searched again within the
  // cache window returns instantly and free. fetchedAt is when the
  // underlying Places call actually ran, cache-hit or not.
  fromCache: boolean
  fetchedAt: string
}

// Server sentinel for "prospects with no group" — a query string can't carry
// null. Must match UNGROUPED_KEY in the API's lib/prospecting.ts.
export const UNGROUPED_KEY = '__ungrouped__'

// Group names are operator-typed ("Med Spa"), so they need encoding.
function prospectQuery(filter: { status?: ProspectStatus; group?: string }): string {
  const params = new URLSearchParams()
  if (filter.status) params.set('status', filter.status)
  if (filter.group) params.set('group', filter.group)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export interface MockupStyle {
  key: string
  label: string
}

// What the API scraped from a prospect's live site (or Places data alone, for
// no-website prospects) — colors/logoUrl come from a real DOM inspection when
// the site could be rendered, name/services/phone from a lighter regex pass.
// Editable in the dashboard's brand-review step before a generation spends it.
// The one sentinel value GET /prospecting/design-references treats as
// "unassigned pool" — see designReferences() above.
export const UNASSIGNED_LIBRARY = 'unassigned'

export interface ExtractedBrand {
  businessName: string | null
  headline: string | null
  services: string[]
  phone: string | null
  colors: string[]
  logoUrl: string | null
  // Real photo URLs found on their current site — hero/service/crew shots —
  // so a concept can reuse actual imagery instead of only CSS gradients.
  photoUrls: string[]
  // A real license/registration number found on the page, e.g. "CCC1331776".
  license: string | null
  // Real trust phrases found verbatim on the page (e.g. "BBB Accredited",
  // "Licensed & Insured") — matched against a fixed phrase list server-side,
  // never a paraphrase.
  certifications: string[]
  // Real partner/material-supplier logo URLs (e.g. a "products we use" strip).
  partnerLogoUrls: string[]
}

// One click of the wizard: a multi-step, multi-provider generation whose
// progress and spend the API writes to a row we poll, rather than holding a
// multi-minute request open.
export type RunStatus = 'running' | 'done' | 'error'
export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error'

export interface RunStep {
  key: string
  label: string
  status: StepStatus
  pct: number
  detail?: string
}

export interface CostItem {
  step: string
  provider: string
  model: string
  kind: 'tokens' | 'image'
  qty: number
  micros: number
}

export interface GenerationRun {
  id: string
  prospectId: string
  status: RunStatus
  steps: RunStep[]
  currentStep: string | null
  mockupId: string | null
  // Millionths of a USD — integer, because provider prices run to fractions of
  // a cent and cents would round most of a run away.
  costMicros: number
  costDetail: CostItem[]
  options: Record<string, unknown>
  error: string | null
  createdAt: string
  finishedAt: string | null
}

export function formatCost(micros: number): string {
  if (!micros) return '$0.00'
  const usd = micros / 1_000_000
  return usd < 1 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`
}

// Layout audit findings recorded against a concept. Advisory: the HTML is
// never rewritten from them.
export interface LayoutFinding {
  kind: 'icon-heading' | 'nav-centring'
  label: string
  delta: number
  viewport: number
}

// The output of the design-analysis pass (a small, separate, cheap-tier
// Claude call — costs a little, unlike scrapeBrand/previewMockup which are
// free): a corrected services list plus concrete style direction derived
// from actually looking at the design references and the current site,
// rather than trusting the blind regex scrape.
export interface DesignAnalysis {
  services: string[]
  styleNotes: string
}

export interface ProspectMockup {
  id: string
  prospectId: string
  styleKey: string
  brand: ExtractedBrand
  prompt: string
  directionNotes: string | null
  // 'html' concepts live in `html`; 'image' is the legacy single-PNG format,
  // kept so already-shared preview links keep showing what was actually sent.
  format: 'image' | 'html'
  html: string | null
  storagePath: string | null
  // Set when the concept was generated layout-first: the full-page draft image
  // the HTML was built from. Internal reference only — never shown to the prospect.
  layoutImagePath: string | null
  layoutFindings: LayoutFinding[] | null
  currentScreenshotPath: string | null
  referenceIds: string[] | null
  libraryId: string | null
  model: string | null
  createdAt: string
}

// What generateMockup would send to Claude, assembled but not sent — no LLM
// call, so building this costs nothing. Meant to be pasted into a free tool
// (ChatGPT, Gemini) to check the design library + prompt before spending real
// tokens on a generation that gets saved.
export interface MockupPreview {
  systemPrompt: string
  userPrompt: string
  combinedPrompt: string
  images: { caption: string; filename: string; dataUrl: string }[]
}

// Operator-named collection of design inspo images — e.g. "Roofing", "Med Spa".
// Chosen explicitly per prospect when generating a concept.
export interface DesignLibrary {
  id: string
  name: string
  description: string | null
  createdAt: string
  referenceCount?: number
}

// The operator's design inspiration library. Concept generation imitates these
// and nothing else — this is where design direction lives.
export interface DesignReference {
  id: string
  label: string
  libraryId: string | null
  notes: string | null
  storagePath: string
  contentType: string
  sizeBytes: number | null
  active: boolean
  createdAt: string
}

// `url` is added by the route (the token alone isn't enough — the API's own
// public base URL is server-side config).
export interface ProspectPreview {
  id: string
  prospectId: string
  mockupId: string | null
  crawlId: string | null
  previewToken: string
  url: string
  expiresAt: string | null
  revokedAt: string | null
  viewCount: number
  firstViewedAt: string | null
  lastViewedAt: string | null
  createdAt: string
}

export interface GscQueryRow {
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface GscTotals {
  clicks: number
  impressions: number
  ctr: number
  position: number
}

export interface GscSnapshot {
  date: string
  queries: GscQueryRow[]
  totals: GscTotals
}

export interface GscRankings {
  connected: boolean
  trend: GscSnapshot[]
  latest: { rows: GscQueryRow[]; totals: GscTotals } | null
}

// ── Paid Ads (Google PPC) ─────────────────────────────────────────────────────
export interface AdsTotals {
  spendCents: number
  impressions: number
  clicks: number
  conversions: number
  conversionsValue: number
  costPerLeadCents: number
  avgCpcCents: number
}

export interface AdsCampaign {
  id: string
  name: string
  status: string
  spendCents: number
  impressions: number
  clicks: number
  conversions: number
}

export interface AdsSnapshot {
  date: string
  totals: AdsTotals
  campaigns: AdsCampaign[]
}

export interface AdsPerformance {
  connected: boolean
  customerId: string | null
  trend: AdsSnapshot[]
  latest: { totals: AdsTotals; campaigns: AdsCampaign[] } | null
}

export interface AdsFeeBreakdown {
  floorCents: number
  pctCents: number
  feeCents: number
  overageCents: number
  pct: number
}

export interface VisibilityQuery {
  id: string
  clientId: string
  query: string
  active: boolean
  createdAt: string
}

export interface VisibilityRun {
  id: string
  clientId: string
  queryId: string
  provider: 'openai' | 'anthropic'
  model: string | null
  mentioned: boolean
  domainCited: boolean
  snippet: string | null
  createdAt: string
}

export interface VisibilityTrendPoint {
  date: string
  mentionRate: number
  total: number
}

export type RequestStatus = 'open' | 'in_progress' | 'done' | 'declined' | 'cancelled'

export interface ChangeRequest {
  id: string
  clientId: string
  title: string
  description: string
  status: RequestStatus
  createdBy: string | null
  cancelReason: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface ChangeRequestWithClient extends ChangeRequest {
  clientName: string
}

export interface RequestEvent {
  id: string
  requestId: string
  fromStatus: RequestStatus | null
  toStatus: RequestStatus
  changedBy: string | null
  note: string | null
  createdAt: string
}

export interface RequestComment {
  id: string
  requestId: string
  authorId: string
  authorName: string
  isSuperadmin: boolean
  body: string
  mentions: string[]
  createdAt: string
}

export interface MentionableUser {
  id: string
  name: string
  isSuperadmin: boolean
}

export interface RequestAttachment {
  id: string
  requestId: string
  filename: string
  contentType: string
  sizeBytes: number
  uploadedBy: string | null
  createdAt: string
}

export interface RequestDetail {
  request: ChangeRequest
  events: RequestEvent[]
  comments: RequestComment[]
  attachments: RequestAttachment[]
}

export interface NotificationSettings {
  client_id: string
  email_enabled: boolean
  email_to: string | null
  slack_enabled: boolean
  slack_webhook_url: string | null
  events: Record<string, boolean>
}

export type PostStatus = 'draft' | 'in_review' | 'approved' | 'published' | 'archived'

export interface BlogPost {
  id: string
  clientId: string
  brief: string
  targetKeyword: string
  title: string | null
  slug: string | null
  metaDescription: string | null
  contentMd: string | null
  status: PostStatus
  model: string | null
  framerItemId: string | null
  createdAt: string
  updatedAt: string
  publishedAt: string | null
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

export interface FramerCollectionField {
  id: string
  name: string
  type: string
}

export interface ReportData {
  clientName: string
  seo: { firstScore: number; lastScore: number; delta: number; auditsInPeriod: number } | null
  visibility: { mentionRate: number; totalChecks: number } | null
  siteHealth: { score: number; topIssues: { title: string; severity: string; count: number }[] } | null
  // Care-tier technical baseline; null when no baseline has been run yet.
  baseline: {
    mobileScore: number | null
    previousMobileScore: number | null
    checks: { key: string; label: string; status: string; detail: string; findings: string[] }[]
  } | null
  // Null when the client has no chat assistant — rendering zeros would read as
  // the chatbot performing badly rather than as a service they don't have.
  chat: {
    conversationsThisMonth: number
    monthlyCap: number
    resolvedRate: number
    estimatedHoursSaved: number
    questionsAnswered: number
    totalLeadsCaptured: number
  } | null
  requestsClosed: number
}

export interface Report {
  id: string
  clientId: string
  periodStart: string
  periodEnd: string
  data: ReportData
  createdAt: string
  sentAt: string | null
  sentTo: string | null
}

// The four Care-tier technical checks. 'unknown' is a real state, not an
// error: it means the source (Lighthouse, or a site crawl) wasn't available,
// and it must render differently from 'good' so an unmeasured check is never
// mistaken for a passing one.
export type BaselineStatus = 'good' | 'warn' | 'poor' | 'unknown'

export interface BaselineCheck {
  key: 'speed' | 'mobile' | 'meta' | 'indexing'
  label: string
  status: BaselineStatus
  score: number | null
  detail: string
  findings: string[]
}

export interface SiteBaseline {
  id: string
  clientId: string
  url: string
  mobileScore: number | null
  checks: BaselineCheck[]
  createdAt: string
}

export interface SendReportResult {
  sent: boolean
  recipient: string | null
  testMode: boolean
  reason?: 'no_sender_configured' | 'sender_not_connected' | 'daily_cap_reached'
}

function analyticsQs(q: AnalyticsQuery): string {
  const p = new URLSearchParams()
  if (q.from && q.to) { p.set('from', q.from); p.set('to', q.to) }
  else if (q.range) p.set('range', String(q.range))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const api = {
  me: () => request<Identity>('/me'),
  reconcile: () => request<{ orgId: string | null }>('/reconcile', { method: 'POST' }),
  clients: {
    list: () => request<Client[]>('/clients'),
    get: (id: string) => request<Client>(`/clients/${id}`),
    upsert: (data: Partial<Client>) =>
      request<Client>('/clients', { method: 'POST', body: JSON.stringify(data) }),
    invite: (id: string, email: string) =>
      request<{ ok: boolean; clerkOrgId: string; invitationId: string }>(`/clients/${id}/invite`, { method: 'POST', body: JSON.stringify({ email }) }),
    remove: (id: string, confirmName: string) =>
      request<{ ok: boolean }>(`/clients/${id}`, { method: 'DELETE', body: JSON.stringify({ confirmName }) }),
    contactAgency: (id: string, message: string) =>
      request<{ ok: boolean }>(`/clients/${id}/contact-agency`, { method: 'POST', body: JSON.stringify({ message }) }),
    uploadWidgetLogo: async (id: string, file: File) => {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${BASE}/clients/${id}/widget-logo`, {
        method: 'POST',
        headers: await authHeaders(),
        body: form
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Upload failed: ${res.status}`)
      }
      return res.json() as Promise<Client>
    },
    removeWidgetLogo: (id: string) =>
      request<Client>(`/clients/${id}/widget-logo`, { method: 'DELETE' }),
    stats: (id: string) => request<DashboardStats>(`/clients/${id}/stats`),
    statsTimeseries: (id: string, days = 14) => request<DailyCount[]>(`/clients/${id}/stats/timeseries?days=${days}`),
    statsUsage: (id: string) => request<MonthlyUsage>(`/clients/${id}/stats/usage`),
    citations: (id: string) =>
      request<{ citations: Citation[]; summary: CitationSummary }>(`/clients/${id}/local/citations`),
    saveCitation: (id: string, data: Partial<Citation> & { directory: string }) =>
      request<Citation>(`/clients/${id}/local/citations`, { method: 'POST', body: JSON.stringify(data) }),
    seedCitations: (id: string) =>
      request<{ added: number }>(`/clients/${id}/local/citations/seed`, { method: 'POST' }),
    deleteCitation: (id: string, citationId: string) =>
      request<{ ok: boolean }>(`/clients/${id}/local/citations/${citationId}`, { method: 'DELETE' }),
    gbpActivity: (id: string, days = 90) =>
      request<{ activity: GbpActivity[]; postsThisMonth: number }>(`/clients/${id}/local/gbp?days=${days}`),
    addGbpActivity: (id: string, data: { kind: GbpKind; title: string; url?: string; performedAt?: string; notes?: string }) =>
      request<GbpActivity>(`/clients/${id}/local/gbp`, { method: 'POST', body: JSON.stringify(data) }),
    deleteGbpActivity: (id: string, activityId: string) =>
      request<{ ok: boolean }>(`/clients/${id}/local/gbp/${activityId}`, { method: 'DELETE' }),
    gbpReviews: (id: string) => request<PlaceSummary>(`/clients/${id}/local/reviews`),
    mapRank: (id: string) => request<{ results: MapRankResult[] }>(`/clients/${id}/local/map-rank`),
    localConfig: (id: string) => request<LocalConfig>(`/clients/${id}/local/config`),
    updateLocalConfig: (id: string, config: Partial<LocalConfig>) =>
      request<LocalConfig>(`/clients/${id}/local/config`, { method: 'PUT', body: JSON.stringify(config) }),
    placeSearch: (id: string, q: string) =>
      request<{ candidates: PlaceCandidate[] }>(`/clients/${id}/local/place-search?q=${encodeURIComponent(q)}`),
    siteHealth: (id: string) => request<SiteHealth | null>(`/clients/${id}/site-health`),
    checkSiteHealth: (id: string) => request<SiteHealth>(`/clients/${id}/site-health/check`, { method: 'POST' }),
    entitlements: (id: string) => request<Entitlements>(`/clients/${id}/entitlements`),
    seoConfig: (id: string) => request<PortalConfig>(`/clients/${id}/seo/config`),
    updateSeoConfig: (id: string, config: Partial<PortalConfig>) =>
      request<PortalConfig>(`/clients/${id}/seo/config`, { method: 'PUT', body: JSON.stringify(config) }),
    seoRankings: (id: string, days = 28) => request<GscRankings>(`/clients/${id}/seo/rankings?days=${days}`),
    snapshotRankings: (id: string) => request<{ ok: boolean }>(`/clients/${id}/seo/rankings/snapshot`, { method: 'POST' }),
    ads: (id: string, days = 30) => request<AdsPerformance>(`/clients/${id}/ads?days=${days}`),
    snapshotAds: (id: string) => request<{ ok: boolean }>(`/clients/${id}/ads/snapshot`, { method: 'POST' }),
    setAdsCustomerId: (id: string, googleAdsCustomerId: string) =>
      request<PortalConfig>(`/clients/${id}/ads/config`, { method: 'PUT', body: JSON.stringify({ googleAdsCustomerId }) }),
    adsFeePreview: (id: string, spendCents: number) =>
      request<AdsFeeBreakdown>(`/billing/${id}/ads-fee?spendCents=${spendCents}`),
    billAdsOverage: (id: string, spendCents: number, period: string) =>
      request<{ billed: boolean; overageCents: number; reason?: string }>(`/billing/${id}/ads-fee`, { method: 'POST', body: JSON.stringify({ spendCents, period }) }),
    targetKeywords: (id: string) => request<{ keywords: TargetKeyword[] }>(`/clients/${id}/seo/keywords`),
    addTargetKeyword: (id: string, keyword: string) =>
      request<{ keywords: TargetKeyword[] }>(`/clients/${id}/seo/keywords`, { method: 'POST', body: JSON.stringify({ keyword }) }),
    removeTargetKeyword: (id: string, keywordId: string) =>
      request<{ keywords: TargetKeyword[] }>(`/clients/${id}/seo/keywords/${keywordId}`, { method: 'DELETE' }),
    checkTargetKeywords: (id: string) =>
      request<{ keywords: TargetKeyword[] }>(`/clients/${id}/seo/keywords/check`, { method: 'POST' }),
    keywordIdeas: (id: string, seed: string) =>
      request<{ ideas: KeywordIdea[] }>(`/clients/${id}/seo/keyword-ideas?seed=${encodeURIComponent(seed)}`),
    latestCrawl: (id: string) => request<SeoCrawl | null>(`/clients/${id}/seo/crawl`),
    crawlHistory: (id: string) => request<CrawlTrendPoint[]>(`/clients/${id}/seo/crawl/history`),
    startCrawl: (id: string) => request<SeoCrawl>(`/clients/${id}/seo/crawl`, { method: 'POST' }),
    refreshCrawl: (id: string, crawlId: string) => request<SeoCrawl>(`/clients/${id}/seo/crawl/${crawlId}`),
    cancelCrawl: (id: string, crawlId: string) => request<SeoCrawl>(`/clients/${id}/seo/crawl/${crawlId}/cancel`, { method: 'POST' }),
    generateMetaFix: (id: string, crawlId: string) =>
      request<{ requestId: string; count: number }>(`/clients/${id}/seo/crawl/${crawlId}/fix/meta`, { method: 'POST' }),
    generateSchemaFix: (id: string) =>
      request<{ requestId: string; count: number }>(`/clients/${id}/seo/fix/schema`, { method: 'POST' }),
    generateLlmsTxt: (id: string) =>
      request<{ requestId: string; count: number }>(`/clients/${id}/seo/fix/llms`, { method: 'POST' }),
    seoOpportunities: (id: string) => request<GscQueryRow[]>(`/clients/${id}/seo/opportunities`),
    visibilityQueries: (id: string) => request<VisibilityQuery[]>(`/clients/${id}/visibility/queries`),
    addVisibilityQuery: (id: string, query: string) =>
      request<VisibilityQuery>(`/clients/${id}/visibility/queries`, { method: 'POST', body: JSON.stringify({ query }) }),
    removeVisibilityQuery: (id: string, queryId: string) =>
      request<{ ok: boolean }>(`/clients/${id}/visibility/queries/${queryId}`, { method: 'DELETE' }),
    runVisibilityCheck: (id: string, queryId?: string) =>
      request<VisibilityRun[]>(`/clients/${id}/visibility/run`, { method: 'POST', body: JSON.stringify({ queryId }) }),
    visibilityRuns: (id: string, days = 30) =>
      request<{ runs: VisibilityRun[]; trend: VisibilityTrendPoint[] }>(`/clients/${id}/visibility/runs?days=${days}`),
    requests: (id: string) => request<ChangeRequest[]>(`/clients/${id}/requests`),
    createRequest: (id: string, title: string, description: string) =>
      request<ChangeRequest>(`/clients/${id}/requests`, { method: 'POST', body: JSON.stringify({ title, description }) }),
    // Superadmin only. Permanent — removes events, comments and attachment
    // files. Clients cancel instead, which keeps the record.
    deleteRequest: (id: string, reqId: string) =>
      request<{ ok: true }>(`/clients/${id}/requests/${reqId}`, { method: 'DELETE' }),
    updateRequestStatus: (id: string, reqId: string, status: RequestStatus) =>
      request<ChangeRequest>(`/clients/${id}/requests/${reqId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    requestDetail: (id: string, reqId: string) => request<RequestDetail>(`/clients/${id}/requests/${reqId}`),
    cancelRequest: (id: string, reqId: string, reason: string) =>
      request<ChangeRequest>(`/clients/${id}/requests/${reqId}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
    addRequestComment: (id: string, reqId: string, body: string, mentions: string[] = []) =>
      request<RequestComment>(`/clients/${id}/requests/${reqId}/comments`, { method: 'POST', body: JSON.stringify({ body, mentions }) }),
    mentionableUsers: (id: string) => request<MentionableUser[]>(`/clients/${id}/mentionable-users`),
    uploadRequestAttachment: async (id: string, reqId: string, file: File) => {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${BASE}/clients/${id}/requests/${reqId}/attachments`, {
        method: 'POST',
        headers: await authHeaders(),
        body: form
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Upload failed: ${res.status}`)
      }
      return res.json() as Promise<RequestAttachment>
    },
    requestAttachmentUrl: (id: string, reqId: string, attachmentId: string) =>
      request<{ url: string }>(`/clients/${id}/requests/${reqId}/attachments/${attachmentId}/url`),
    notificationSettings: (id: string) => request<NotificationSettings>(`/clients/${id}/notification-settings`),
    updateNotificationSettings: (id: string, patch: {
      emailEnabled?: boolean; emailTo?: string; slackEnabled?: boolean; slackWebhookUrl?: string; events?: Record<string, boolean>
    }) => request<NotificationSettings>(`/clients/${id}/notification-settings`, { method: 'PUT', body: JSON.stringify(patch) }),
    posts: (id: string) => request<BlogPost[]>(`/clients/${id}/posts`),
    generatePost: (id: string, brief: string, targetKeyword: string) =>
      request<BlogPost>(`/clients/${id}/posts/generate`, { method: 'POST', body: JSON.stringify({ brief, targetKeyword }) }),
    updatePost: (id: string, postId: string, patch: Partial<Pick<BlogPost, 'title' | 'slug' | 'metaDescription' | 'contentMd' | 'brief' | 'targetKeyword'>>) =>
      request<BlogPost>(`/clients/${id}/posts/${postId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    transitionPost: (id: string, postId: string, status: PostStatus) =>
      request<BlogPost>(`/clients/${id}/posts/${postId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    publishPost: (id: string, postId: string) =>
      request<BlogPost>(`/clients/${id}/posts/${postId}/publish`, { method: 'POST' }),
    exportPost: async (id: string, postId: string, filename: string) => {
      const res = await fetch(`${BASE}/clients/${id}/posts/${postId}/export`, { headers: await authHeaders() })
      if (!res.ok) throw new Error(`Export failed: ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    },
    framerConnection: (id: string) => request<FramerConnection | null>(`/clients/${id}/framer-connection`),
    saveFramerConnection: (id: string, projectUrl: string, apiKey: string, collectionId: string, fieldMapping: FramerFieldMapping) =>
      request<FramerConnection>(`/clients/${id}/framer-connection`, {
        method: 'PUT',
        body: JSON.stringify({ projectUrl, apiKey, collectionId, fieldMapping })
      }),
    deleteFramerConnection: (id: string) => request<{ ok: boolean }>(`/clients/${id}/framer-connection`, { method: 'DELETE' }),
    framerFields: (id: string) => request<FramerCollectionField[]>(`/clients/${id}/framer-connection/fields`),
    // Technical SEO baseline (Care tier). Not gated behind the SEO add-on —
    // Care includes no services, so this is the technical read those clients
    // are entitled to. See lib/site-baseline.ts on the API.
    baseline: (id: string) => request<SiteBaseline | null>(`/clients/${id}/baseline`),
    runBaseline: (id: string) => request<SiteBaseline>(`/clients/${id}/baseline/run`, { method: 'POST' }),
    reports: (id: string) => request<Report[]>(`/clients/${id}/reports`),
    generateReport: (id: string) => request<Report>(`/clients/${id}/reports/generate`, { method: 'POST', body: JSON.stringify({}) }),
    // Superadmin only. Does not free the month for the monthly scheduler to
    // re-send — see deleteReport() on the API.
    deleteReport: (id: string, reportId: string) =>
      request<{ ok: true }>(`/clients/${id}/reports/${reportId}`, { method: 'DELETE' }),
    sendReport: (id: string, reportId: string, to: string) =>
      request<SendReportResult>(`/clients/${id}/reports/${reportId}/send`, { method: 'POST', body: JSON.stringify({ to }) }),
    leads: (id: string) => request<Lead[]>(`/clients/${id}/leads`),
    updateLeadStatus: (id: string, leadId: string, status: LeadStatus) =>
      request<Lead>(`/clients/${id}/leads/${leadId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    deleteLead: (id: string, leadId: string) =>
      request<{ ok: boolean }>(`/clients/${id}/leads/${leadId}`, { method: 'DELETE' }),
    knowledge: (id: string) => request<KnowledgeDoc[]>(`/clients/${id}/knowledge`),
    addKnowledge: (id: string, title: string, content: string, description?: string) =>
      request<{ documentId: string; ids: string[]; chunks: number }>(`/clients/${id}/knowledge`, {
        method: 'POST',
        body: JSON.stringify({ title, content, description })
      }),
    uploadKnowledge: async (id: string, file: File, description?: string) => {
      const form = new FormData()
      form.append('file', file)
      if (description) form.append('description', description)
      const res = await fetch(`${BASE}/clients/${id}/knowledge/upload`, {
        method: 'POST',
        headers: await authHeaders(),
        body: form
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Upload failed: ${res.status}`)
      }
      return res.json() as Promise<{ documentId: string; ids: string[]; chunks: number }>
    },
    deleteKnowledgeDocument: (id: string, documentId: string) =>
      request<{ ok: boolean }>(`/clients/${id}/knowledge/${documentId}`, { method: 'DELETE' }),
    updateKnowledgeDescription: (id: string, documentId: string, description: string) =>
      request<{ ok: boolean }>(`/clients/${id}/knowledge/${documentId}`, { method: 'PATCH', body: JSON.stringify({ description }) }),
    knowledgeFiles: (id: string) => request<KnowledgeFile[]>(`/clients/${id}/knowledge/files`),
    knowledgeFileUrl: (id: string, fileId: string) =>
      request<{ url: string }>(`/clients/${id}/knowledge/files/${fileId}/url`),
    team: (id: string) => request<Team>(`/clients/${id}/team`),
    inviteTeamMember: (id: string, email: string, role: TeamRole) =>
      request<TeamInvitation>(`/clients/${id}/team/invitations`, {
        method: 'POST',
        body: JSON.stringify({ email, role })
      }),
    revokeTeamInvitation: (id: string, invitationId: string) =>
      request<{ ok: boolean }>(`/clients/${id}/team/invitations/${invitationId}`, { method: 'DELETE' }),
    updateTeamMemberRole: (id: string, userId: string, role: TeamRole) =>
      request<TeamMember>(`/clients/${id}/team/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ role })
      }),
    removeTeamMember: (id: string, userId: string) =>
      request<{ ok: boolean }>(`/clients/${id}/team/members/${userId}`, { method: 'DELETE' }),
    connectors: (id: string) => request<ConnectorStatus>(`/clients/${id}/connectors`),
    gmailAuthUrl: (id: string) => request<{ url: string }>(`/clients/${id}/gmail/auth-url`),
    disconnectGmail: (id: string) => request<{ ok: boolean }>(`/clients/${id}/gmail`, { method: 'DELETE' }),

    // ── Chat analytics (Insights tab) ────────────────────────────────────────
    analyticsHeadline: (id: string, q: AnalyticsQuery) =>
      request<Headline>(`/clients/${id}/analytics/headline${analyticsQs(q)}`),
    analyticsTimeseries: (id: string, q: AnalyticsQuery) =>
      request<TrendPoint[]>(`/clients/${id}/analytics/timeseries${analyticsQs(q)}`),
    analyticsTopQuestions: (id: string, q: AnalyticsQuery) =>
      request<QuestionCluster[]>(`/clients/${id}/analytics/top-questions${analyticsQs(q)}`),
    analyticsUnanswered: (id: string, q: AnalyticsQuery) =>
      request<UnansweredEntry[]>(`/clients/${id}/analytics/unanswered${analyticsQs(q)}`),
    analyticsCoverage: (id: string, q: AnalyticsQuery) =>
      request<CoverageEntry[]>(`/clients/${id}/analytics/coverage${analyticsQs(q)}`),
    exportTranscript: async (id: string, q: AnalyticsQuery, filename: string) => {
      const res = await fetch(`${BASE}/clients/${id}/analytics/transcript.csv${analyticsQs(q)}`, { headers: await authHeaders() })
      if (!res.ok) throw new Error(`Export failed: ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    }
  },
  billing: {
    tiers: () => request<TierInfo[]>('/billing/tiers'),
    services: () => request<ServiceInfo[]>('/billing/services'),
    get: (clientId: string) => request<{ subscription: SubscriptionInfo | null; plan: PlanInfo | null }>(`/billing/${clientId}`),
    checkout: (clientId: string, priceId: string) =>
      request<{ url: string }>(`/billing/${clientId}/checkout`, { method: 'POST', body: JSON.stringify({ priceId }) }),
    portal: (clientId: string) =>
      request<{ url: string }>(`/billing/${clientId}/portal`, { method: 'POST' }),
    tierLink: (clientId: string, tierKey: string) =>
      request<{ url: string }>(`/billing/${clientId}/tier-link?tierKey=${encodeURIComponent(tierKey)}`),
    subscriptions: (clientId: string) =>
      request<ClientSubscriptionSummary[]>(`/billing/${clientId}/subscriptions`),
    cancelSubscription: (clientId: string, subId: string) =>
      request<{ ok: boolean }>(`/billing/${clientId}/subscriptions/${subId}/cancel`, { method: 'POST' }),
    addon: (clientId: string, serviceKey: ServiceKey, action: 'add' | 'remove') =>
      request<{ ok: boolean; entitlements: Entitlements }>(`/billing/${clientId}/addons`, {
        method: 'POST',
        body: JSON.stringify({ serviceKey, action })
      }),
    compService: (clientId: string, serviceKey: ServiceKey, revoke = false) =>
      request<{ ok: boolean; entitlements: Entitlements }>(`/billing/${clientId}/services/comp`, {
        method: 'POST',
        body: JSON.stringify({ serviceKey, revoke })
      })
  },
  overview: {
    summary: () => request<OverviewSummary>('/overview/summary'),
    clients: () => request<ClientRollup[]>('/overview/clients'),
    requests: () => request<ChangeRequestWithClient[]>('/overview/requests'),
    audits: () => request<SeoCrawl[]>('/overview/audits'),
    startAudit: (url: string) => request<SeoCrawl>('/overview/audits', { method: 'POST', body: JSON.stringify({ url }) }),
    refreshAudit: (crawlId: string) => request<SeoCrawl>(`/overview/audits/${crawlId}`),
    updateRequestStatus: (clientId: string, reqId: string, status: RequestStatus) =>
      request<ChangeRequest>(`/overview/requests/${clientId}/${reqId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    // The platform's own Gmail sender — used for ALL platform-sent email
    // (Clerk-relayed invitations, reports, change-request notifications),
    // never a client's own inbox. See lib/gmail.ts's platform_gmail_token.
    platformGmail: () => request<ConnectorStatus['gmail']>('/overview/platform-gmail'),
    platformGmailAuthUrl: () => request<{ url: string }>('/overview/platform-gmail/auth-url'),
    disconnectPlatformGmail: () => request<{ ok: boolean }>('/overview/platform-gmail', { method: 'DELETE' })
  },

  prospecting: {
    discover: (opts: { category: string; area: string; minRating?: number; minReviewCount?: number; noWebsiteOnly?: boolean; forceRefresh?: boolean }) =>
      request<DiscoveryResult>('/prospecting/discover', { method: 'POST', body: JSON.stringify(opts) }),
    list: (filter: { status?: ProspectStatus; group?: string } = {}) =>
      request<Prospect[]>(`/prospecting${prospectQuery(filter)}`),
    save: (candidate: ProspectCandidate, category: string, area: string, groupName?: string) =>
      request<Prospect>('/prospecting', { method: 'POST', body: JSON.stringify({ candidate, category, area, groupName }) }),
    // One round trip for a whole checkbox selection; already-saved businesses
    // upsert harmlessly rather than duplicating.
    saveMany: (candidates: ProspectCandidate[], category: string, area: string, groupName?: string) =>
      request<{ saved: number; prospects: Prospect[] }>('/prospecting/bulk', {
        method: 'POST', body: JSON.stringify({ candidates, category, area, groupName }),
      }),
    renameGroup: (from: string, to: string) =>
      request<{ moved: number }>('/prospecting/groups/rename', { method: 'POST', body: JSON.stringify({ from, to }) }),
    update: (id: string, patch: { status?: ProspectStatus; email?: string | null; notes?: string | null; groupName?: string | null }) =>
      request<Prospect>(`/prospecting/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    delete: (id: string) =>
      request<{ ok: true }>(`/prospecting/${id}`, { method: 'DELETE' }),
    generateDrafts: (id: string) =>
      request<Prospect>(`/prospecting/${id}/draft`, { method: 'POST' }),
    // Fuller value-prop email (mockup + real service value props + book-a-
    // call) — a distinct draft type, meant for once a mockup exists.
    generateValueDraft: (id: string) =>
      request<Prospect>(`/prospecting/${id}/value-draft`, { method: 'POST' }),
    audit: (id: string) =>
      request<SeoCrawl>(`/prospecting/${id}/audit`, { method: 'POST' }),
    // CSV export needs the auth header, so it can't be a plain <a href>; fetch
    // the text and let the caller trigger a Blob download.
    exportCsv: async (filter: { status?: ProspectStatus; group?: string } = {}): Promise<string> => {
      const res = await rawFetch(`/prospecting/export.csv${prospectQuery(filter)}`, undefined, false)
      if (!res.ok) throw new Error(`Export failed: ${res.status}`)
      return res.text()
    },
    mockupStyles: () => request<MockupStyle[]>('/prospecting/mockup-styles'),
    mockups: (id: string) => request<ProspectMockup[]>(`/prospecting/${id}/mockups`),
    // Scrape-only, no persistence, zero LLM cost — backs the brand-review step
    // so the operator sees (and can correct) the extraction before generating.
    scrapeBrand: (id: string) => request<ExtractedBrand>(`/prospecting/${id}/brand`, { method: 'POST' }),
    // Costs one cheap-tier Claude call (unlike scrapeBrand above) — looks at
    // the design references + current site and returns a corrected services
    // list plus concrete style direction, instead of trusting the raw scrape.
    analyzeDesign: (id: string, opts: { libraryId?: string | null; primaryReferenceId?: string | null; brandOverride?: Partial<ExtractedBrand> } = {}) =>
      request<DesignAnalysis>(`/prospecting/${id}/analyze`, { method: 'POST', body: JSON.stringify(opts) }),
    // layoutFirst draws a full-page design image for this business first and
    // uses it as the layout spec for the HTML, instead of making Claude average
    // the generic library references. Costs an extra image generation and
    // roughly doubles wall time, so it's opt-in per generation.
    // aiPhotos swaps the business's own scraped photos for clean AI-generated
    // stock photography — worth it when their real imagery is low-quality,
    // badly cropped, or has text burned into it. Costs two extra image
    // generations, so it's opt-in alongside layoutFirst.
    generateMockup: (id: string, opts: { styleKey?: string; directionNotes?: string; styleNotes?: string; libraryId?: string | null; primaryReferenceId?: string | null; brandOverride?: Partial<ExtractedBrand>; layoutFirst?: boolean; aiPhotos?: boolean } = {}) =>
      request<ProspectMockup>(`/prospecting/${id}/mockups`, { method: 'POST', body: JSON.stringify(opts) }),
    previewMockup: (id: string, opts: { directionNotes?: string; styleNotes?: string; libraryId?: string | null; primaryReferenceId?: string | null; brandOverride?: Partial<ExtractedBrand> } = {}) =>
      request<MockupPreview>(`/prospecting/${id}/mockups/preview`, { method: 'POST', body: JSON.stringify(opts) }),
    // Real AI-generated PNG concept — same body shape as generateMockup/
    // previewMockup above, parallel HTML/image entry points sharing the same
    // brand/reference/style-notes controls.
    generateImageMockup: (id: string, opts: { directionNotes?: string; styleNotes?: string; libraryId?: string | null; primaryReferenceId?: string | null; brandOverride?: Partial<ExtractedBrand> } = {}) =>
      request<ProspectMockup>(`/prospecting/${id}/mockups/image`, { method: 'POST', body: JSON.stringify(opts) }),
    previewImageMockup: (id: string, opts: { directionNotes?: string; styleNotes?: string; libraryId?: string | null; primaryReferenceId?: string | null; brandOverride?: Partial<ExtractedBrand> } = {}) =>
      request<MockupPreview>(`/prospecting/${id}/mockups/image/preview`, { method: 'POST', body: JSON.stringify(opts) }),
    // The image needs the auth header, so it can't be a plain <img src>; fetch
    // the bytes and hand back an object URL the caller must revoke.
    mockupImageUrl: async (mockupId: string): Promise<string> => {
      const res = await rawFetch(`/prospecting/mockups/${mockupId}/image`, undefined, false)
      if (!res.ok) throw new Error(`Failed to load image: ${res.status}`)
      return URL.createObjectURL(await res.blob())
    },
    // The layout-first draft the concept was built from. Same auth-header
    // reason as mockupImageUrl above for not being a plain <img src>.
    mockupLayoutImageUrl: async (mockupId: string): Promise<string> => {
      const res = await rawFetch(`/prospecting/mockups/${mockupId}/layout-image`, undefined, false)
      if (!res.ok) throw new Error(`Failed to load layout draft: ${res.status}`)
      return URL.createObjectURL(await res.blob())
    },
    // Starts the wizard and returns immediately with a run to poll — the job
    // itself runs detached on the API, so closing the tab doesn't kill it.
    startGeneration: (id: string, opts: { libraryId?: string | null; primaryReferenceId?: string | null; directionNotes?: string; brandOverride?: Partial<ExtractedBrand>; aiPhotos?: boolean; layoutFirst?: boolean } = {}) =>
      request<GenerationRun>(`/prospecting/${id}/generate`, { method: 'POST', body: JSON.stringify(opts) }),
    // Fails (400) if a live preview link points at this concept — the API
    // refuses rather than leaving an already-shared URL rendering an empty
    // page. Surface the message; it tells the operator to revoke first.
    deleteMockup: (mockupId: string) =>
      request<{ ok: true }>(`/prospecting/mockups/${mockupId}`, { method: 'DELETE' }),
    getRun: (runId: string) => request<GenerationRun>(`/prospecting/runs/${runId}`),
    latestRun: (id: string, kind: 'concept' | 'email' = 'concept') =>
      request<GenerationRun | null>(`/prospecting/${id}/latest-run?kind=${kind}`),
    // One click: links the chosen concept, audits their site, and writes the
    // outreach email from both. Async like startGeneration — returns a run to
    // poll, because the audit alone runs for minutes.
    startEmail: (id: string, opts: { mockupId?: string | null; audit?: boolean } = {}) =>
      request<GenerationRun>(`/prospecting/${id}/email`, { method: 'POST', body: JSON.stringify(opts) }),
    previews: (id: string) => request<ProspectPreview[]>(`/prospecting/${id}/previews`),
    createPreview: (id: string, opts: { mockupId?: string | null; crawlId?: string | null } = {}) =>
      request<ProspectPreview>(`/prospecting/${id}/previews`, { method: 'POST', body: JSON.stringify(opts) }),
    revokePreview: (previewId: string) =>
      request<ProspectPreview>(`/prospecting/previews/${previewId}/revoke`, { method: 'POST' }),

    designLibraries: () => request<DesignLibrary[]>('/prospecting/design-libraries'),
    createDesignLibrary: (name: string, description?: string) =>
      request<DesignLibrary>('/prospecting/design-libraries', { method: 'POST', body: JSON.stringify({ name, description }) }),
    updateDesignLibrary: (libraryId: string, patch: { name?: string; description?: string | null }) =>
      request<DesignLibrary>(`/prospecting/design-libraries/${libraryId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    deleteDesignLibrary: (libraryId: string) =>
      request<{ ok: true }>(`/prospecting/design-libraries/${libraryId}`, { method: 'DELETE' }),

    // libraryId: omit for "all references"; UNASSIGNED_LIBRARY for the
    // unassigned pool; a real library id for that library only. The backend
    // (GET /design-references) is the source of truth for this contract —
    // sending anything else for "unassigned" either 500s (an arbitrary string
    // doesn't parse as a library uuid) or silently falls through to "all",
    // which is exactly the two ways this broke before: the library-management
    // page's filter sent a sentinel the backend didn't recognize, and the
    // per-prospect reference picker sent `undefined` for "no library",
    // which reads as "no filter" rather than "the unassigned pool" — so an
    // operator picking a primary reference while on "no library" could see
    // thumbnails from every library, then have the pick silently dropped at
    // generation time because it wasn't actually in the unassigned pool.
    designReferences: (opts: { includeInactive?: boolean; libraryId?: string } = {}) => {
      const params = new URLSearchParams()
      if (opts.includeInactive) params.set('includeInactive', 'true')
      if (opts.libraryId) params.set('libraryId', opts.libraryId)
      const qs = params.toString()
      return request<DesignReference[]>(`/prospecting/design-references${qs ? `?${qs}` : ''}`)
    },
    uploadDesignReference: async (file: File, meta: { label?: string; libraryId?: string; notes?: string } = {}) => {
      const form = new FormData()
      form.append('file', file)
      if (meta.label) form.append('label', meta.label)
      if (meta.libraryId) form.append('libraryId', meta.libraryId)
      if (meta.notes) form.append('notes', meta.notes)
      const res = await fetch(`${BASE}/prospecting/design-references`, {
        method: 'POST',
        headers: await authHeaders(),
        body: form
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Upload failed: ${res.status}`)
      }
      return res.json() as Promise<DesignReference>
    },
    updateDesignReference: (refId: string, patch: { label?: string; libraryId?: string | null; notes?: string | null; active?: boolean }) =>
      request<DesignReference>(`/prospecting/design-references/${refId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    deleteDesignReference: (refId: string) =>
      request<{ ok: true }>(`/prospecting/design-references/${refId}`, { method: 'DELETE' }),
    // Auth'd like mockupImageUrl — object URL, caller must revoke.
    designReferenceImageUrl: async (refId: string): Promise<string> => {
      const res = await rawFetch(`/prospecting/design-references/${refId}/image`, undefined, false)
      if (!res.ok) throw new Error(`Failed to load image: ${res.status}`)
      return URL.createObjectURL(await res.blob())
    }
  }
}
