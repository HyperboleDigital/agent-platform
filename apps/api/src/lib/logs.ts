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
