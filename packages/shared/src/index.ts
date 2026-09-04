// ─── Shared types across API, dashboard, and widget ──────────────────────────

// 'roi-calculator' leads arrive via the public website ROI calculator
// endpoint (apps/api/src/routes/roi-leads.ts), not a conversation.
export type Channel = 'chat' | 'email' | 'roi-calculator'
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
  // What the visitor was after, captured from the model's capture_lead
  // summary / escalation reason when the inline email form is shown WITHOUT
  // an email (the tool call that knows "interested in speaker X" and the
  // /contact submission are separate requests — this rides along through the
  // widget so the lead + notification keep that context).
  context?: string
  // Per-turn instrumentation the chat route persists to message_logs (and the
  // client analytics dashboard reads back). Never sent to the widget.
  telemetry?: MessageTelemetry
  metadata?: Record<string, unknown>
}

export interface MessageTelemetry {
  sessionId: string
  userMessage: string
  assistantResponse: string
  confidence: number | null   // real KB-retrieval confidence (0..1), null if no vector hit
  escalated: boolean
  escalationReason?: string
  resolvedBy: 'agent' | 'human'
  toolsUsed: string[]
  retrievedDocIds: string[]
  queryEmbedding: number[] | null
  // LLM cost accounting (migrate_2026-09-03_chat-cost.sql). Absent when the
  // provider response carried no usage block.
  model?: string
  inputTokens?: number
  outputTokens?: number
  costMicros?: number
}

export type Vertical = 'local' | 'b2b'

// Who hosts the client's website — see Client.hosting below.
export type HostingOwner = 'us' | 'client'

// Default knowledge-base retrieval confidence (top match cosine similarity)
// below which the assistant admits it's unsure and offers a human instead of
// answering. Shared so the orchestrator (which enforces it) and the analytics
// "unanswered" filter (which reports on it) can never drift apart.
//
// Calibrated for voyage-3.5-lite, whose good-match similarities land ~0.45–0.55
// — a higher bar (e.g. 0.7) punts answerable questions to a human and tanks the
// deflection rate. Per-client override via AgentConfig.confidenceThreshold.
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.35

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
  widgetConfig: WidgetConfig   // public chat-widget appearance — no secrets
  // NO LONGER a pricing dimension (the Local/B2B tier split was collapsed
  // 2026-08-18) — kept only as a harmless segmentation tag.
  vertical: Vertical | null
  tierKey: string | null       // key into lib/tiers.ts's tier catalog ('care' | 'seo' | 'growth')
  // Who owns the platform the client's site runs on. 'us' (default) = we host
  // → Care is the default post-launch retainer; the hosting/uptime tier bullet
  // and Site Health card apply. 'client' = client-owned infra (e.g. their own
  // Squarespace) → the default retainer is the chatbot, and hosting promises +
  // Site Health are suppressed (we can't act on uptime we don't control).
  hosting: HostingOwner
  // Clean dashboard URL identifier (e.g. "spec-id"), separate from Clerk's own
  // auto-generated org slug. Auto-assigned at creation, editable by a
  // superadmin. Used only for building /clients/:slug URLs — every internal
  // API call still keys off `id`.
  slug: string
  // Internal-dashboard-only org logo (breadcrumb, app-shell chrome) — NOT the
  // public widget logo in widgetConfig. logoUrl is a short-lived signed URL,
  // computed server-side on read; never persisted or cached by the client.
  logoPath?: string | null
  logoContentType?: string | null
  logoUrl?: string | null
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
  // Google Ads customer id for the Paid Ads (PPC) reporting section, e.g.
  // "123-456-7890". Hyperbole has manager (MCC) access; the client pays Google
  // directly. Unset = the Paid Ads section shows its "connect account" state.
  googleAdsCustomerId?: string
  // Monthly ceiling (in cents) on what scheduled jobs may spend on paid APIs
  // (DataForSEO crawls/SERP checks, visibility LLM calls) for this client.
  // Unset = the default in lib/scheduled-jobs.ts ($5). The dispatcher sums
  // job_runs.cost_cents for the calendar month before starting a paid job and
  // records 'budget_exceeded' instead of running when the ceiling is reached;
  // superadmin run-now deliberately bypasses it.
  jobBudgetCents?: number
}

export interface AgentConfig {
  systemPromptExtra?: string
  knowledgeBaseIds: string[]
  calendlyLink?: string
  slackWebhook?: string
  // Where captured LEADS (contact form, chatbot capture, ROI calculator) are
  // sent. Comma-separated for multiple recipients (goes verbatim into the
  // email's To: header). Also the fallback for support escalations when
  // supportEmail is unset.
  escalationEmail?: string
  // Opt this client out of Slack escalation alerts entirely — including the
  // platform-wide SLACK_WEBHOOK_URL fallback, which otherwise applies to every
  // client with no webhook of their own. Set/cleared from the Connectors tab.
  slackDisabled?: boolean
  // Where SUPPORT escalations ("the assistant couldn't answer / get a human")
  // are sent, when they should go somewhere other than the lead recipients —
  // e.g. Spec-ID's contact@spec-id.com. Unset = escalationEmail.
  supportEmail?: string
  autoSendThreshold: number
  emailDraft: boolean
  // Below this KB-retrieval confidence (top match cosine similarity, 0..1) the
  // agent admits it's unsure and offers a human instead of answering. Defaults
  // to DEFAULT_CONFIDENCE_THRESHOLD. Private — not in widgetConfig, which is
  // world-readable.
  confidenceThreshold?: number
  // Business hours for the "after-hours coverage" analytics metric. A message
  // outside these hours is one a human would likely have missed. Unset = the
  // analytics layer's default (Mon–Fri 09:00–17:00 in the given tz).
  businessHours?: BusinessHours
  // Live-but-unmanaged: set when a client downgrades off a chat-including tier
  // but keeps their previously-built assistant running (chat persistence at
  // Care — see lib/tier-transitions.ts). The widget answers, conversations are
  // logged, leads are captured; KB retraining, new document ingestion, the
  // unanswered-questions review, and prompt changes are NOT included. Cleared
  // automatically when they move back onto a chat-including tier.
  chatUnmanaged?: boolean
}

export interface BusinessHours {
  tz: string          // IANA zone, e.g. "America/New_York"
  days: number[]      // open weekdays, 0=Sun … 6=Sat, e.g. [1,2,3,4,5]
  start: string       // "HH:MM" 24h, e.g. "09:00"
  end: string         // "HH:MM" 24h, e.g. "17:00"
}

// Chat widget appearance, per client. Every field is optional and an empty
// object must render exactly the widget's built-in defaults, so a client with
// no config still gets a working widget.
//
// ⚠️ This is served UNAUTHENTICATED from GET /widget-config/:clientId — the
// client UUID is visible in the page source of every site embedding the widget,
// so treat everything here as world-readable. Never add a secret to this type.
export interface WidgetConfig {
  title?: string
  tagline?: string
  welcome?: string
  placeholder?: string
  color?: string        // primary brand colour, e.g. "#1D9E75"
  color2?: string       // secondary, used in gradients; defaults to `color`
  logo?: string         // externally-hosted logo URL for the bubble/header avatar
  // Storage path of an uploaded logo (widget-logos bucket). Takes precedence
  // over `logo` — the public config endpoint resolves it to an absolute URL on
  // our own origin, so the widget never sees the raw path.
  logoPath?: string
  logoContentType?: string
  avatarEmoji?: string  // fallback avatar when there's no logo
  // Short questions that rotate above the CLOSED bubble to invite a click.
  prompts?: string[]
  // Buttons shown inside the panel on first open. `label` is the button text,
  // `message` is what actually gets sent as the visitor's message. Max 4 — the
  // grid and staggered animations in widget.js assume four.
  chips?: { label: string; message: string }[]
  // Hostnames this client's widget may run on, e.g. ["spec-id.com"]. Matching
  // covers the host and all its subdomains (see isOriginAllowed).
  //
  // EMPTY OR UNSET MEANS "ANY DOMAIN" — that is the backward-compatible
  // default, so an existing install keeps working until an operator opts in.
  allowedDomains?: string[]
  // Extra fields on the contact/lead-capture forms (header "Get in touch" and
  // the inline capture_lead/escalate form), beyond the built-in Name/Email/
  // Message. Unset means the built-in form only — this keeps every existing
  // client's widget unchanged until an operator opts a client in.
  contactFields?: WidgetContactFields
  // Copy overrides for the inline LEAD form (the one capture_lead opens).
  // The built-in copy is demo-flavored ("Let's set up your demo") — right
  // for a software client, wrong for e.g. an ingredient supplier whose hot
  // lead wants a quote or samples. Every key optional; unset keeps the
  // built-in default, so existing clients render unchanged.
  leadForm?: WidgetLeadFormCopy
}

export interface WidgetLeadFormCopy {
  title?: string      // form heading, default "Let's set up your demo"
  sub?: string        // sub-line, default "Drop your details and we'll reach out to get it scheduled."
  btn?: string        // submit button, default "Request demo"
  donePre?: string    // confirmation before the email, default "Perfect — your demo request is in! 🎉 We'll reach out at "
  donePost?: string   // confirmation after the email, default " to get it scheduled."
  reason?: string     // notification email "Reason:" line, default "Visitor requested a demo"
}

export interface WidgetContactFields {
  company?: boolean       // ask for Company Name
  phone?: boolean         // ask for Phone
  // A "which division/category" question, e.g. Spec-ID's Flooring/Tiling/
  // Ceiling/... divisions. Unset or empty divisions = not shown.
  divisionLabel?: string  // defaults to "Identify Your Primary Business" in the widget
  divisions?: string[]
  // false/unset = single-select (radio buttons, one value). true = checkboxes,
  // multiple values allowed — stored/notified as a comma-separated string
  // since `leads.division` is a single text column.
  divisionMultiSelect?: boolean
  // ── Built-in field presentation ──────────────────────────────────────────
  // Every key below defaults to today's behavior, so a client with none of
  // them set keeps rendering exactly the same form.
  // Render Name as two inputs (First name / Last name). Joined with a space
  // into the single `leads.name` column on submit — presentation only.
  splitName?: boolean
  // Label/placeholder overrides for the Message textarea, e.g. a client whose
  // form asks "How can we help?" instead of "Message".
  messageLabel?: string
  messagePlaceholder?: string
  // The static "Get in touch" form requires a message today; true makes it
  // optional there too (the inline lead-capture form already treats it as
  // optional, and an empty message is stored as a placeholder string).
  messageOptional?: boolean
  // Label override for the Phone input, e.g. "Phone number".
  phoneLabel?: string
  // Company/Phone are required whenever shown today; true keeps the field on
  // the form but lets the visitor skip it.
  companyOptional?: boolean
  phoneOptional?: boolean
}

// Is `origin` (a browser Origin header, e.g. "https://www.spec-id.com") allowed
// to use this client's widget?
//
// ⚠️ This is the ONLY real enforcement point for domain locking. The widget
// script is public and trivially editable, so any check performed inside
// widget.js is advisory UX at best — the server must reject the request. Call
// this on every public per-client route (/chat, /contact, /widget-config).
//
// The Origin header is set by the browser and is not writable by page JS, so
// this reliably stops the realistic threat: someone copying the script tag onto
// their own site. It does NOT stop a non-browser client (curl, a script) that
// forges the header — those are handled by the per-client rate limits and
// spend caps, not by this.
export function isOriginAllowed(origin: string | undefined, allowed: string[] | undefined): boolean {
  // Not configured = open, so adding this field never breaks a live client.
  if (!allowed || allowed.length === 0) return true
  // Configured but no Origin means a non-browser caller; deny, since a real
  // embed always sends one (the widget is cross-origin to this API).
  if (!origin) return false

  let host: string
  try {
    host = new URL(origin).hostname.toLowerCase()
  } catch {
    return false
  }

  return allowed.some(entry => {
    // Operators paste all of "spec-id.com", "https://spec-id.com/",
    // "*.spec-id.com" — normalise to a bare hostname rather than making them
    // learn a format.
    const domain = entry
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^\*\./, '')
      .replace(/\/.*$/, '')
      .replace(/:\d+$/, '')
    if (!domain) return false
    // The leading dot is what makes this safe: it matches real subdomains but
    // not a lookalike registration like "evil-spec-id.com".
    return host === domain || host.endsWith(`.${domain}`)
  })
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
  company?: string
  phone?: string
  division?: string
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
