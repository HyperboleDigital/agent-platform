import { supabase } from './supabase'
import { getClientById } from './clients'
import { DEFAULT_CONFIDENCE_THRESHOLD, type BusinessHours } from '@agent-platform/shared'

// Client-facing chat analytics. Every query here is scoped by client_id — that
// is the tenant boundary, and it is NOT optional (see the cross-tenant leakage
// test in apps/api/test/analytics-tenant.test.ts). The route layer additionally
// gates on canAccessClient before any of these run.

// Sane default when a client hasn't configured business hours: US weekday
// 9-to-5, Eastern. Only affects the "after-hours coverage" metric.
const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  tz: 'America/New_York',
  days: [1, 2, 3, 4, 5],
  start: '09:00',
  end: '17:00'
}

// Two questions this close (cosine) are treated as "the same question" when
// clustering Top Questions. Tuned for voyage-3.5-lite query embeddings.
const QUESTION_CLUSTER_THRESHOLD = 0.85

export interface DateRange {
  from: Date
  to: Date
}

// ── helpers ───────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000

function dayKey(iso: string): string {
  return iso.slice(0, 10) // YYYY-MM-DD (UTC)
}

// Zero-filled list of UTC day keys spanning [from, to].
function dayKeys(range: DateRange): string[] {
  const keys: string[] = []
  const start = Date.UTC(range.from.getUTCFullYear(), range.from.getUTCMonth(), range.from.getUTCDate())
  const end = Date.UTC(range.to.getUTCFullYear(), range.to.getUTCMonth(), range.to.getUTCDate())
  for (let t = start; t <= end; t += DAY_MS) keys.push(new Date(t).toISOString().slice(0, 10))
  return keys
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// Is `date` outside the client's business hours (in their configured tz)? Uses
// Intl so DST is handled correctly without pulling in a tz library.
function isAfterHours(date: Date, bh: BusinessHours): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: bh.tz, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit'
  }).formatToParts(date)
  const weekdayStr = parts.find(p => p.type === 'weekday')?.value ?? 'Mon'
  let hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0')
  if (hour === 24) hour = 0 // some environments render midnight as "24"
  const weekday = WEEKDAY[weekdayStr] ?? 1
  if (!bh.days.includes(weekday)) return true
  const mins = hour * 60 + minute
  return mins < hhmmToMinutes(bh.start) || mins >= hhmmToMinutes(bh.end)
}

// pgvector columns come back from PostgREST as a "[0.1,0.2,...]" string (or,
// depending on version, an array). Normalize to number[] | null.
function parseEmbedding(value: unknown): number[] | null {
  if (Array.isArray(value)) return value as number[]
  if (typeof value === 'string' && value.startsWith('[')) {
    try { return JSON.parse(value) as number[] } catch { return null }
  }
  return null
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

async function businessHoursFor(clientId: string): Promise<BusinessHours> {
  const client = await getClientById(clientId)
  return client?.agentConfig?.businessHours ?? DEFAULT_BUSINESS_HOURS
}

async function confidenceThresholdFor(clientId: string): Promise<number> {
  const client = await getClientById(clientId)
  return client?.agentConfig?.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD
}

// ── sessions (conversation-level source rows) ────────────────────────────────

interface SessionRow {
  session_id: string
  started_at: string
  escalated: boolean
  outcome: string
  lead_captured: boolean
}

async function fetchSessions(clientId: string, range: DateRange): Promise<SessionRow[]> {
  const { data, error } = await supabase
    .from('chat_sessions')
    .select('session_id, started_at, escalated, outcome, lead_captured')
    .eq('client_id', clientId)
    .gte('started_at', range.from.toISOString())
    .lte('started_at', range.to.toISOString())
  if (error) { console.error('[analytics] fetchSessions', error.message); return [] }
  return (data ?? []) as SessionRow[]
}

async function countLeads(clientId: string, range: DateRange): Promise<number> {
  const { count, error } = await supabase
    .from('leads')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('created_at', range.from.toISOString())
    .lte('created_at', range.to.toISOString())
  if (error) { console.error('[analytics] countLeads', error.message); return 0 }
  return count ?? 0
}

// ── 1–4. Headline numbers ────────────────────────────────────────────────────

export interface HeadlineMetric {
  value: number
  previous: number
  // Fractional change vs. previous period (0.2 = +20%). null when the previous
  // period was zero (no baseline to compare against — the UI shows "—").
  changePct: number | null
}

export interface Headline {
  conversations: HeadlineMetric
  leads: HeadlineMetric
  deflectionRate: HeadlineMetric   // 0..1 — share of conversations with no human escalation
  afterHoursCoverage: HeadlineMetric // 0..1 — share of conversations outside business hours
}

function change(value: number, previous: number): number | null {
  if (previous === 0) return null
  return (value - previous) / previous
}

function metric(value: number, previous: number): HeadlineMetric {
  return { value, previous, changePct: change(value, previous) }
}

// Previous period of equal length, immediately preceding `range`.
function previousRange(range: DateRange): DateRange {
  const span = range.to.getTime() - range.from.getTime()
  return { from: new Date(range.from.getTime() - span - 1), to: new Date(range.from.getTime() - 1) }
}

export async function getHeadline(clientId: string, range: DateRange): Promise<Headline> {
  const prev = previousRange(range)
  const bh = await businessHoursFor(clientId)

  const [curSessions, prevSessions, curLeads, prevLeads] = await Promise.all([
    fetchSessions(clientId, range),
    fetchSessions(clientId, prev),
    countLeads(clientId, range),
    countLeads(clientId, prev)
  ])

  const summarize = (sessions: SessionRow[]) => {
    const total = sessions.length
    const deflected = sessions.filter(s => !s.escalated).length
    const afterHours = sessions.filter(s => isAfterHours(new Date(s.started_at), bh)).length
    return {
      conversations: total,
      deflectionRate: total ? deflected / total : 0,
      afterHoursCoverage: total ? afterHours / total : 0
    }
  }
  const cur = summarize(curSessions)
  const pre = summarize(prevSessions)

  return {
    conversations: metric(cur.conversations, pre.conversations),
    leads: metric(curLeads, prevLeads),
    deflectionRate: metric(cur.deflectionRate, pre.deflectionRate),
    afterHoursCoverage: metric(cur.afterHoursCoverage, pre.afterHoursCoverage)
  }
}

// ── 5–7. Trends ──────────────────────────────────────────────────────────────

export interface TrendPoint {
  date: string          // YYYY-MM-DD (UTC)
  conversations: number
  leads: number
  escalations: number
}

export async function getTimeseries(clientId: string, range: DateRange): Promise<TrendPoint[]> {
  const [sessions, leadRows] = await Promise.all([
    fetchSessions(clientId, range),
    supabase.from('leads').select('created_at')
      .eq('client_id', clientId)
      .gte('created_at', range.from.toISOString())
      .lte('created_at', range.to.toISOString())
      .then(r => (r.data ?? []) as { created_at: string }[])
  ])

  const buckets = new Map<string, TrendPoint>()
  for (const key of dayKeys(range)) buckets.set(key, { date: key, conversations: 0, leads: 0, escalations: 0 })

  for (const s of sessions) {
    const b = buckets.get(dayKey(s.started_at))
    if (!b) continue
    b.conversations++
    if (s.escalated) b.escalations++
  }
  for (const l of leadRows) {
    const b = buckets.get(dayKey(l.created_at))
    if (b) b.leads++
  }
  return Array.from(buckets.values())
}

// ── 8. Top questions (clustered) ─────────────────────────────────────────────

export interface QuestionCluster {
  question: string   // representative (first-seen) phrasing
  count: number
  examples: string[] // up to 3 alternate phrasings in the cluster
}

interface QuestionRow {
  user_message: string
  query_embedding: unknown
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim()
}

export async function getTopQuestions(clientId: string, range: DateRange, limit = 20): Promise<QuestionCluster[]> {
  const { data, error } = await supabase
    .from('message_logs')
    .select('user_message, query_embedding')
    .eq('client_id', clientId)
    .eq('channel', 'chat')
    .not('user_message', 'is', null)
    .gte('created_at', range.from.toISOString())
    .lte('created_at', range.to.toISOString())
    .limit(5000)
  if (error) { console.error('[analytics] getTopQuestions', error.message); return [] }

  interface Cluster { question: string; count: number; examples: string[]; centroid: number[] | null }
  const clusters: Cluster[] = []
  const byNormalized = new Map<string, Cluster>() // fast path for embedding-less rows

  for (const row of (data ?? []) as QuestionRow[]) {
    const text = row.user_message?.trim()
    if (!text) continue
    const emb = parseEmbedding(row.query_embedding)

    if (emb) {
      // Semantic clustering: attach to the nearest cluster above threshold.
      let best: Cluster | null = null
      let bestSim = QUESTION_CLUSTER_THRESHOLD
      for (const c of clusters) {
        if (!c.centroid) continue
        const sim = cosine(emb, c.centroid)
        if (sim >= bestSim) { bestSim = sim; best = c }
      }
      if (best) {
        best.count++
        if (best.examples.length < 3 && !best.examples.includes(text) && text !== best.question) best.examples.push(text)
      } else {
        clusters.push({ question: text, count: 1, examples: [], centroid: emb })
      }
    } else {
      // Fallback: group by normalized text (don't over-engineer — matches the
      // agreed plan when embeddings aren't configured).
      const key = normalize(text)
      const existing = byNormalized.get(key)
      if (existing) {
        existing.count++
        if (existing.examples.length < 3 && !existing.examples.includes(text) && text !== existing.question) existing.examples.push(text)
      } else {
        const c: Cluster = { question: text, count: 1, examples: [], centroid: null }
        byNormalized.set(key, c)
        clusters.push(c)
      }
    }
  }

  return clusters
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map(c => ({ question: c.question, count: c.count, examples: c.examples }))
}

// ── 9. Unanswered / low-confidence questions ─────────────────────────────────

export interface UnansweredEntry {
  createdAt: string
  sessionId: string | null
  question: string
  confidence: number | null
  reason: string | null
  resolvedBy: string | null
}

export async function getUnanswered(clientId: string, range: DateRange, limit = 200): Promise<UnansweredEntry[]> {
  const threshold = await confidenceThresholdFor(clientId)
  const { data, error } = await supabase
    .from('message_logs')
    .select('created_at, session_id, user_message, confidence, escalation_reason, resolved_by')
    .eq('client_id', clientId)
    .eq('channel', 'chat')
    .not('user_message', 'is', null)
    // Escalated OR fell below the confidence threshold — the "here's what we're
    // fixing this month" list. Both filters stay client-scoped.
    .or(`escalated.eq.true,confidence.lt.${threshold}`)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) { console.error('[analytics] getUnanswered', error.message); return [] }

  return ((data ?? []) as any[]).map(r => ({
    createdAt: r.created_at,
    sessionId: r.session_id,
    question: r.user_message,
    confidence: r.confidence,
    reason: r.escalation_reason,
    resolvedBy: r.resolved_by
  }))
}

// ── 10. Knowledge base coverage ──────────────────────────────────────────────

export interface CoverageEntry {
  documentId: string
  title: string
  retrievals: number
}

export async function getCoverage(clientId: string, range: DateRange): Promise<CoverageEntry[]> {
  const [logs, docs] = await Promise.all([
    supabase.from('message_logs').select('retrieved_doc_ids')
      .eq('client_id', clientId)
      .gte('created_at', range.from.toISOString())
      .lte('created_at', range.to.toISOString())
      .limit(20000)
      .then(r => (r.data ?? []) as { retrieved_doc_ids: string[] | null }[]),
    supabase.from('knowledge_base').select('id, document_id, title')
      .eq('client_id', clientId)
      .then(r => (r.data ?? []) as { id: string; document_id: string; title: string }[])
  ])

  // chunk id → document id/title (a document is many chunk rows).
  const chunkToDoc = new Map<string, { documentId: string; title: string }>()
  const docTitle = new Map<string, string>()
  for (const d of docs) {
    chunkToDoc.set(d.id, { documentId: d.document_id, title: d.title })
    docTitle.set(d.document_id, d.title)
  }

  const counts = new Map<string, number>()
  for (const doc of docTitle.keys()) counts.set(doc, 0) // zero-fill so stale docs surface
  for (const row of logs) {
    for (const chunkId of row.retrieved_doc_ids ?? []) {
      const doc = chunkToDoc.get(chunkId)
      if (doc) counts.set(doc.documentId, (counts.get(doc.documentId) ?? 0) + 1)
    }
  }

  return Array.from(counts.entries())
    .map(([documentId, retrievals]) => ({ documentId, title: docTitle.get(documentId) ?? 'Untitled', retrievals }))
    .sort((a, b) => b.retrievals - a.retrievals)
}

// ── Transcript CSV export ────────────────────────────────────────────────────

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return `"${s.replace(/"/g, '""')}"`
}

export async function getTranscriptCsv(clientId: string, range: DateRange): Promise<string> {
  const { data, error } = await supabase
    .from('message_logs')
    .select('created_at, session_id, intent, confidence, escalated, user_message, assistant_response')
    .eq('client_id', clientId)
    .eq('channel', 'chat')
    .gte('created_at', range.from.toISOString())
    .lte('created_at', range.to.toISOString())
    .order('session_id', { ascending: true })
    .order('created_at', { ascending: true })
    .limit(50000)
  if (error) { console.error('[analytics] getTranscriptCsv', error.message); throw new Error('Failed to build transcript') }

  const header = ['Timestamp', 'Session', 'Intent', 'Confidence', 'Escalated', 'Visitor message', 'Assistant response']
  const rows = ((data ?? []) as any[]).map(r => [
    r.created_at, r.session_id, r.intent,
    r.confidence ?? '', r.escalated ? 'yes' : 'no',
    r.user_message ?? '', r.assistant_response ?? ''
  ].map(csvCell).join(','))

  return [header.map(csvCell).join(','), ...rows].join('\r\n')
}
