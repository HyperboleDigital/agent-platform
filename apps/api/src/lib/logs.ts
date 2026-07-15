import { supabase } from './supabase'
import type { Channel, Intent } from '@agent-platform/shared'

export interface LogEntry {
  clientId: string
  channel: Channel
  intent: Intent
  resolved: boolean
  durationMs: number
}

// Fire-and-forget: never let logging failures break a chat response.
export async function logMessage(entry: LogEntry): Promise<void> {
  const { error } = await supabase.from('message_logs').insert({
    client_id: entry.clientId,
    channel: entry.channel,
    intent: entry.intent,
    resolved: entry.resolved,
    duration_ms: entry.durationMs
  })
  if (error) console.error('[logs] failed to write message_log', error.message)
}

export interface DashboardStats {
  messagesThisWeek: number
  leadsThisWeek: number
  openEscalations: number
  resolvedRate: number // 0..1

  // Lifetime "impact" metrics for the client to show off.
  totalConversations: number
  totalLeadsCaptured: number
  questionsAnswered: number // resolved FAQ-intent conversations, all time
  estimatedHoursSaved: number
}

export interface DailyCount {
  date: string // YYYY-MM-DD (UTC)
  count: number
  resolved: number
}

// Day-by-day message counts for the trend chart. Zero-fills days with no
// activity so the chart has no gaps.
export async function getDailyMessageCounts(clientId: string, days = 14): Promise<DailyCount[]> {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1)))

  const { data, error } = await supabase
    .from('message_logs')
    .select('created_at, resolved')
    .eq('client_id', clientId)
    .gte('created_at', start.toISOString())
    .order('created_at', { ascending: true })
  if (error) console.error('[logs] getDailyMessageCounts error', error.message)

  const buckets = new Map<string, DailyCount>()
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60 * 1000)
    const key = d.toISOString().slice(0, 10)
    buckets.set(key, { date: key, count: 0, resolved: 0 })
  }
  for (const row of data ?? []) {
    const key = (row.created_at as string).slice(0, 10)
    const bucket = buckets.get(key)
    if (!bucket) continue
    bucket.count++
    if (row.resolved) bucket.resolved++
  }
  return Array.from(buckets.values())
}

// Rough estimate of how long a human would take to handle one conversation
// the bot resolved on its own (read the message, look something up, reply).
// Shown to clients as an approximation, not a precise figure.
const ASSUMED_MINUTES_SAVED_PER_RESOLVED_CONVO = 6

export async function getStats(clientId: string): Promise<DashboardStats> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const count = { count: 'exact' as const, head: true }

  const [
    messagesWeek, resolvedWeek, leadsWeek, escalations,
    totalConversations, totalLeads, questionsAnswered, totalResolved
  ] = await Promise.all([
    supabase.from('message_logs').select('*', count)
      .eq('client_id', clientId).gte('created_at', weekAgo),
    supabase.from('message_logs').select('*', count)
      .eq('client_id', clientId).gte('created_at', weekAgo).eq('resolved', true),
    supabase.from('leads').select('*', count)
      .eq('client_id', clientId).gte('created_at', weekAgo),
    supabase.from('escalations').select('*', count)
      .eq('client_id', clientId).eq('status', 'open'),
    supabase.from('message_logs').select('*', count)
      .eq('client_id', clientId),
    supabase.from('leads').select('*', count)
      .eq('client_id', clientId),
    supabase.from('message_logs').select('*', count)
      .eq('client_id', clientId).eq('resolved', true).eq('intent', 'faq'),
    supabase.from('message_logs').select('*', count)
      .eq('client_id', clientId).eq('resolved', true)
  ])

  const weekTotal = messagesWeek.count ?? 0
  return {
    messagesThisWeek: weekTotal,
    leadsThisWeek: leadsWeek.count ?? 0,
    openEscalations: escalations.count ?? 0,
    resolvedRate: weekTotal ? (resolvedWeek.count ?? 0) / weekTotal : 0,

    totalConversations: totalConversations.count ?? 0,
    totalLeadsCaptured: totalLeads.count ?? 0,
    questionsAnswered: questionsAnswered.count ?? 0,
    estimatedHoursSaved: Math.round(((totalResolved.count ?? 0) * ASSUMED_MINUTES_SAVED_PER_RESOLVED_CONVO) / 60 * 10) / 10
  }
}
