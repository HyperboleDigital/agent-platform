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
  hookSource: string | null
  notes: string | null
  createdAt: string
}

export interface DiscoveryResult {
  count: number
  candidates: ProspectCandidate[]
}

export interface MockupStyle {
  key: string
  label: string
}

export interface ProspectMockup {
  id: string
  prospectId: string
  styleKey: string
  brand: {
    businessName: string | null
    headline: string | null
    services: string[]
    phone: string | null
    colors: string[]
    logoUrl: string | null
  }
  prompt: string
  directionNotes: string | null
  // 'html' concepts live in `html`; 'image' is the legacy single-PNG format,
  // kept so already-shared preview links keep showing what was actually sent.
  format: 'image' | 'html'
  html: string | null
  storagePath: string | null
  currentScreenshotPath: string | null
  referenceIds: string[] | null
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

// The operator's design inspiration library. Concept generation imitates these
// and nothing else — this is where design direction lives.
export interface DesignReference {
  id: string
  label: string
  vertical: string | null
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
  chat: {
    conversationsThisMonth: number
    monthlyCap: number
    resolvedRate: number
    estimatedHoursSaved: number
    questionsAnswered: number
    totalLeadsCaptured: number
  }
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

export interface SendReportResult {
  sent: boolean
  recipient: string | null
  testMode: boolean
  reason?: 'no_sender_configured' | 'sender_not_connected' | 'daily_cap_reached'
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
    reports: (id: string) => request<Report[]>(`/clients/${id}/reports`),
    generateReport: (id: string) => request<Report>(`/clients/${id}/reports/generate`, { method: 'POST', body: JSON.stringify({}) }),
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
    disconnectGmail: (id: string) => request<{ ok: boolean }>(`/clients/${id}/gmail`, { method: 'DELETE' })
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
      request<ChangeRequest>(`/overview/requests/${clientId}/${reqId}`, { method: 'PATCH', body: JSON.stringify({ status }) })
  },

  prospecting: {
    discover: (opts: { category: string; area: string; minRating?: number; minReviewCount?: number; noWebsiteOnly?: boolean }) =>
      request<DiscoveryResult>('/prospecting/discover', { method: 'POST', body: JSON.stringify(opts) }),
    list: (status?: ProspectStatus) =>
      request<Prospect[]>(`/prospecting${status ? `?status=${status}` : ''}`),
    save: (candidate: ProspectCandidate, category: string, area: string) =>
      request<Prospect>('/prospecting', { method: 'POST', body: JSON.stringify({ candidate, category, area }) }),
    update: (id: string, patch: { status?: ProspectStatus; email?: string | null; notes?: string | null }) =>
      request<Prospect>(`/prospecting/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    delete: (id: string) =>
      request<{ ok: true }>(`/prospecting/${id}`, { method: 'DELETE' }),
    generateDrafts: (id: string) =>
      request<Prospect>(`/prospecting/${id}/draft`, { method: 'POST' }),
    audit: (id: string) =>
      request<SeoCrawl>(`/prospecting/${id}/audit`, { method: 'POST' }),
    // CSV export needs the auth header, so it can't be a plain <a href>; fetch
    // the text and let the caller trigger a Blob download.
    exportCsv: async (status?: ProspectStatus): Promise<string> => {
      const res = await rawFetch(`/prospecting/export.csv${status ? `?status=${status}` : ''}`, undefined, false)
      if (!res.ok) throw new Error(`Export failed: ${res.status}`)
      return res.text()
    },
    mockupStyles: () => request<MockupStyle[]>('/prospecting/mockup-styles'),
    mockups: (id: string) => request<ProspectMockup[]>(`/prospecting/${id}/mockups`),
    generateMockup: (id: string, opts: { styleKey?: string; directionNotes?: string } = {}) =>
      request<ProspectMockup>(`/prospecting/${id}/mockups`, { method: 'POST', body: JSON.stringify(opts) }),
    previewMockup: (id: string, opts: { directionNotes?: string } = {}) =>
      request<MockupPreview>(`/prospecting/${id}/mockups/preview`, { method: 'POST', body: JSON.stringify(opts) }),
    // The image needs the auth header, so it can't be a plain <img src>; fetch
    // the bytes and hand back an object URL the caller must revoke.
    mockupImageUrl: async (mockupId: string): Promise<string> => {
      const res = await rawFetch(`/prospecting/mockups/${mockupId}/image`, undefined, false)
      if (!res.ok) throw new Error(`Failed to load image: ${res.status}`)
      return URL.createObjectURL(await res.blob())
    },
    previews: (id: string) => request<ProspectPreview[]>(`/prospecting/${id}/previews`),
    createPreview: (id: string, opts: { mockupId?: string | null; crawlId?: string | null } = {}) =>
      request<ProspectPreview>(`/prospecting/${id}/previews`, { method: 'POST', body: JSON.stringify(opts) }),
    revokePreview: (previewId: string) =>
      request<ProspectPreview>(`/prospecting/previews/${previewId}/revoke`, { method: 'POST' }),

    designReferences: (includeInactive = false) =>
      request<DesignReference[]>(`/prospecting/design-references${includeInactive ? '?includeInactive=true' : ''}`),
    uploadDesignReference: async (file: File, meta: { label?: string; vertical?: string; notes?: string } = {}) => {
      const form = new FormData()
      form.append('file', file)
      if (meta.label) form.append('label', meta.label)
      if (meta.vertical) form.append('vertical', meta.vertical)
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
    updateDesignReference: (refId: string, patch: { label?: string; vertical?: string | null; notes?: string | null; active?: boolean }) =>
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
