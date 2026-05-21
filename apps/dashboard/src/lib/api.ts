const BASE = (typeof import_meta !== 'undefined' && (import_meta as any).env?.VITE_API_URL) ?? 'http://localhost:3001'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers }
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json() as Promise<T>
}

export const api = {
  clients: {
    list: () => request('/clients'),
    get: (id: string) => request(`/clients/${id}`),
    upsert: (data: unknown) => request('/clients', { method: 'POST', body: JSON.stringify(data) }),
    addKnowledge: (id: string, title: string, content: string) =>
      request(`/clients/${id}/knowledge`, { method: 'POST', body: JSON.stringify({ title, content }) })
  }
}
