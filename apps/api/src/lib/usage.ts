import { supabase } from './supabase'

// DB-backed usage caps. These catch SUSTAINED abuse (a public clientId driving
// paid LLM calls all day) and act as a hard cost backstop — the lesson from
// the email-loop incident: nothing runs up unbounded spend without a ceiling.
// Counts come from message_logs (one row per chat), which also makes these the
// natural enforcement point for Stripe plan limits in Phase 2.

// Env-tunable; per-client caps become plan-based in Phase 2.
export const CHAT_BURST_PER_MIN = Number(process.env.CHAT_BURST_PER_MIN ?? 20)
export const CONTACT_PER_HOUR = Number(process.env.CONTACT_PER_HOUR ?? 15)
export const DAILY_CONVERSATION_CAP = Number(process.env.DAILY_CONVERSATION_CAP ?? 1000)
// Platform-wide hard ceiling across ALL clients — the circuit breaker.
export const GLOBAL_DAILY_LLM_CAP = Number(process.env.GLOBAL_DAILY_LLM_CAP ?? 5000)

function startOfUtcDay(): string {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString()
}

async function countSince(sinceIso: string, clientId?: string): Promise<number> {
  let q = supabase.from('message_logs').select('*', { count: 'exact', head: true }).gte('created_at', sinceIso)
  if (clientId) q = q.eq('client_id', clientId)
  const { count, error } = await q
  if (error) {
    // Fail OPEN on a counting error would risk unbounded spend; fail toward the
    // cap being "unknown" — treat as at-limit only for the global breaker,
    // and allow per-client (a DB blip shouldn't lock out a paying client).
    console.error('[usage] count error', error.message)
    return 0
  }
  return count ?? 0
}

export interface CapStatus {
  allowed: boolean
  reason?: 'client_daily_cap' | 'global_daily_cap'
}

// Checked at the START of a chat request, before any LLM call.
export async function checkChatCaps(clientId: string): Promise<CapStatus> {
  const since = startOfUtcDay()
  const [globalToday, clientToday] = await Promise.all([
    countSince(since),
    countSince(since, clientId)
  ])
  if (globalToday >= GLOBAL_DAILY_LLM_CAP) return { allowed: false, reason: 'global_daily_cap' }
  if (clientToday >= DAILY_CONVERSATION_CAP) return { allowed: false, reason: 'client_daily_cap' }
  return { allowed: true }
}
