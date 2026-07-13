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
}

// SEO/portal soft config — audit target pages, brand terms for AI-visibility
// mention matching, and the connected Google Search Console property.
export interface PortalConfig {
  seoPages?: string[]
  brandTerms?: string[]
  gscProperty?: string // e.g. "sc-domain:example.com" or "https://example.com/"
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

export interface Lead {
  id: string
  clientId: string
  name?: string
  email: string
  intent: string
  summary: string
  channel: Channel
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
