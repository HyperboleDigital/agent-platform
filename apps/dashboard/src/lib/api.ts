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

export const api = {
  clients: {
    list: () => request<Client[]>('/clients'),
    get: (id: string) => request<Client>(`/clients/${id}`),
    upsert: (data: Partial<Client>) =>
      request<Client>('/clients', { method: 'POST', body: JSON.stringify(data) }),
    stats: (id: string) => request<DashboardStats>(`/clients/${id}/stats`),
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
  }
}
