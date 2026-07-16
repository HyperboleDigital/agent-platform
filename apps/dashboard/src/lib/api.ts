import type { Client, Lead, LeadStatus } from '@agent-platform/shared'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

// Set once by <AuthBridge/> (mounted inside <ClerkProvider>) so plain fetch
// calls here can attach a fresh session token per request. No static secret
// ever lives in this bundle — see AuthBridge.tsx.
let getToken: (() => Promise<string | null>) | null = null
export function setTokenGetter(fn: () => Promise<string | null>) {
  getToken = fn
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = getToken ? await getToken() : null
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
      ...options?.headers
    }
  })
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

export interface SubscriptionInfo {
  id: string
  clientId: string
  stripeCustomerId: string
  stripeSubscriptionId: string | null
  stripePriceId: string | null
  status: string
  currentPeriodEnd: string | null
}

export interface Identity {
  userId: string
  orgId: string | null
  isSuperadmin: boolean
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
}

export type ServiceKey = 'seo' | 'content' | 'reviews' | 'social'

export interface ServiceInfo {
  key: ServiceKey
  priceId: string
  name: string
  monthlyPriceCents: number
  description: string
  status: 'available' | 'coming_soon'
}

export interface ServiceEntitlement {
  entitled: boolean
  source: 'addon' | 'comp' | null
  status: 'available' | 'coming_soon'
}

export interface Entitlements {
  active: boolean
  planKey: string | null
  services: Record<ServiceKey, ServiceEntitlement>
}

export interface AuditScores {
  performance: number
  seo: number
  accessibility: number
  bestPractices: number
}

export interface AuditMetrics {
  lcpMs?: number
  cls?: number
  inpMs?: number
  tbtMs?: number
}

export interface SeoAudit {
  id: string
  clientId: string
  url: string
  strategy: 'mobile' | 'desktop'
  scores: AuditScores
  metrics: AuditMetrics
  recommendations: string
  createdAt: string
}

export interface PortalConfig {
  seoPages?: string[]
  brandTerms?: string[]
  gscProperty?: string
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
  isSuperadmin: boolean
  body: string
  createdAt: string
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
  clients: {
    list: () => request<Client[]>('/clients'),
    get: (id: string) => request<Client>(`/clients/${id}`),
    upsert: (data: Partial<Client>) =>
      request<Client>('/clients', { method: 'POST', body: JSON.stringify(data) }),
    stats: (id: string) => request<DashboardStats>(`/clients/${id}/stats`),
    statsTimeseries: (id: string, days = 14) => request<DailyCount[]>(`/clients/${id}/stats/timeseries?days=${days}`),
    statsUsage: (id: string) => request<MonthlyUsage>(`/clients/${id}/stats/usage`),
    entitlements: (id: string) => request<Entitlements>(`/clients/${id}/entitlements`),
    seoConfig: (id: string) => request<PortalConfig>(`/clients/${id}/seo/config`),
    updateSeoConfig: (id: string, config: Partial<PortalConfig>) =>
      request<PortalConfig>(`/clients/${id}/seo/config`, { method: 'PUT', body: JSON.stringify(config) }),
    seoAudits: (id: string, days = 90) => request<SeoAudit[]>(`/clients/${id}/seo/audits?days=${days}`),
    runSeoAudit: (id: string) => request<SeoAudit[]>(`/clients/${id}/seo/audits`, { method: 'POST' }),
    seoRankings: (id: string, days = 28) => request<GscRankings>(`/clients/${id}/seo/rankings?days=${days}`),
    snapshotRankings: (id: string) => request<{ ok: boolean }>(`/clients/${id}/seo/rankings/snapshot`, { method: 'POST' }),
    latestCrawl: (id: string) => request<SeoCrawl | null>(`/clients/${id}/seo/crawl`),
    startCrawl: (id: string) => request<SeoCrawl>(`/clients/${id}/seo/crawl`, { method: 'POST' }),
    refreshCrawl: (id: string, crawlId: string) => request<SeoCrawl>(`/clients/${id}/seo/crawl/${crawlId}`),
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
    addRequestComment: (id: string, reqId: string, body: string) =>
      request<RequestComment>(`/clients/${id}/requests/${reqId}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
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
    connectors: (id: string) => request<ConnectorStatus>(`/clients/${id}/connectors`),
    gmailAuthUrl: (id: string) => request<{ url: string }>(`/clients/${id}/gmail/auth-url`),
    disconnectGmail: (id: string) => request<{ ok: boolean }>(`/clients/${id}/gmail`, { method: 'DELETE' })
  },
  billing: {
    plans: () => request<PlanInfo[]>('/billing/plans'),
    services: () => request<ServiceInfo[]>('/billing/services'),
    get: (clientId: string) => request<{ subscription: SubscriptionInfo | null; plan: PlanInfo | null }>(`/billing/${clientId}`),
    checkout: (clientId: string, priceId: string) =>
      request<{ url: string }>(`/billing/${clientId}/checkout`, { method: 'POST', body: JSON.stringify({ priceId }) }),
    portal: (clientId: string) =>
      request<{ url: string }>(`/billing/${clientId}/portal`, { method: 'POST' }),
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
  }
}
