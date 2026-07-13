import type { Client, Lead } from '@agent-platform/shared'

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
  if (!res.ok) throw new Error(`API error: ${res.status}`)
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
  id: string
  title: string
  url: string | null
  created_at: string
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
    leads: (id: string) => request<Lead[]>(`/clients/${id}/leads`),
    knowledge: (id: string) => request<KnowledgeDoc[]>(`/clients/${id}/knowledge`),
    addKnowledge: (id: string, title: string, content: string) =>
      request<{ ids: string[]; chunks: number }>(`/clients/${id}/knowledge`, {
        method: 'POST',
        body: JSON.stringify({ title, content })
      }),
    uploadKnowledge: async (id: string, file: File) => {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${BASE}/clients/${id}/knowledge/upload`, {
        method: 'POST',
        headers: await authHeaders(),
        body: form
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Upload failed: ${res.status}`)
      }
      return res.json() as Promise<{ ids: string[]; chunks: number }>
    },
    connectors: (id: string) => request<ConnectorStatus>(`/clients/${id}/connectors`),
    gmailAuthUrl: (id: string) => request<{ url: string }>(`/clients/${id}/gmail/auth-url`)
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
    clients: () => request<ClientRollup[]>('/overview/clients')
  }
}
