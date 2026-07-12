import type { Client, Lead } from '@agent-platform/shared'

const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'
const API_SECRET = import.meta.env.VITE_API_SECRET ?? ''

function authHeaders(): Record<string, string> {
  return API_SECRET ? { Authorization: `Bearer ${API_SECRET}` } : {}
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
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
        headers: authHeaders(),
        body: form
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Upload failed: ${res.status}`)
      }
      return res.json() as Promise<{ ids: string[]; chunks: number }>
    },
    connectors: (id: string) => request<ConnectorStatus>(`/clients/${id}/connectors`)
  }
}
