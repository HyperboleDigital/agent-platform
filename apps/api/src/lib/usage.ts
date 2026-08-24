import { supabase } from './supabase'
import { getSubscription, planForSubscription } from './billing'

// DB-backed usage caps. These catch SUSTAINED abuse (a public clientId driving
// paid LLM calls all day) and act as a hard cost backstop — the lesson from
// the email-loop incident: nothing runs up unbounded spend without a ceiling.
// Counts come from message_logs (one row per chat), which also makes these the
// natural enforcement point for Stripe plan limits in Phase 2.
//
// Two separate caps, on purpose:
// - Daily abuse ceiling (DAILY_CONVERSATION_CAP): a generic technical safety
//   net independent of plan, high enough that no legitimate paying client
//   should ever hit it in a single day.
// - Monthly plan cap (plan.conversationCap): the actual business limit sold on
//   the pricing page ("Up to 500 conversations/month") — checked against a
//   calendar-month window, not a daily one.

export const CHAT_BURST_PER_MIN = Number(process.env.CHAT_BURST_PER_MIN ?? 20)
export const CONTACT_PER_HOUR = Number(process.env.CONTACT_PER_HOUR ?? 15)
export const DAILY_CONVERSATION_CAP = Number(process.env.DAILY_CONVERSATION_CAP ?? 1000)
// Platform-wide hard ceiling across ALL clients — the circuit breaker.
export const GLOBAL_DAILY_LLM_CAP = Number(process.env.GLOBAL_DAILY_LLM_CAP ?? 5000)
// Fallback monthly cap when no Stripe plan is resolvable (billing not
// configured on this deployment, or client isn't subscribed yet).
export const DEFAULT_MONTHLY_CAP = Number(process.env.DEFAULT_MONTHLY_CONVERSATION_CAP ?? 1000)

function startOfUtcDay(): string {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString()
}

function startOfUtcMonth(): string {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString()
}

// Returns null when the count could NOT be established. Callers must decide
// what an unknown count means for their specific cap — returning 0 here would
// silently mean "no usage yet", which reads as "under every limit" and turns a
// database blip into uncapped spend.
//
// TWO UNITS, deliberately:
//
// - countMessagesSince: message_logs rows. One row = one LLM call. This is the
//   unit of SPEND, so it's what the global daily breaker counts.
// - countConversationsSince: chat_sessions rows. One row = one conversation.
//   This is the unit the pricing sheet SELLS ("conversations/month"), so it's
//   what the per-client caps and the dashboard usage card count. Counting
//   messages here double-charged multi-message chats: a client whose visitors
//   had 2 conversations of 2 messages each showed "4 of 1,000" on Billing
//   while the Assistant page truthfully said 2 conversations handled.
async function countMessagesSince(sinceIso: string, clientId?: string): Promise<number | null> {
  let q = supabase.from('message_logs').select('*', { count: 'exact', head: true }).gte('created_at', sinceIso)
  if (clientId) q = q.eq('client_id', clientId)
  const { count, error } = await q
  if (error) {
    console.error('[usage] count error', error.message)
    return null
  }
  return count ?? 0
}

async function countConversationsSince(sinceIso: string, clientId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from('chat_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .gte('started_at', sinceIso)
  if (error) {
    console.error('[usage] conversation count error', error.message)
    return null
  }
  return count ?? 0
}

export interface CapStatus {
  allowed: boolean
  reason?: 'client_daily_cap' | 'client_monthly_cap' | 'global_daily_cap'
}

// Checked at the START of a chat request, before any LLM call.
export async function checkChatCaps(clientId: string): Promise<CapStatus> {
  const [globalToday, clientToday, clientThisMonth, sub] = await Promise.all([
    countMessagesSince(startOfUtcDay()), // spend unit: every message is an LLM call
    countConversationsSince(startOfUtcDay(), clientId),
    countConversationsSince(startOfUtcMonth(), clientId),
    getSubscription(clientId)
  ])
  const plan = sub ? planForSubscription(sub.stripePriceId) : null
  const monthlyCap = plan?.conversationCap ?? DEFAULT_MONTHLY_CAP

  // Asymmetric on purpose, and this is the whole point of the null:
  //
  // The global breaker FAILS CLOSED. It is the last line of defence against
  // unbounded spend across every client at once, and an unknown count is
  // exactly when it most needs to hold.
  //
  // The per-client caps FAIL OPEN. They protect a business limit, not the
  // platform, and a transient database error must not take a paying client's
  // assistant offline on their own website.
  if (globalToday === null || globalToday >= GLOBAL_DAILY_LLM_CAP) {
    return { allowed: false, reason: 'global_daily_cap' }
  }
  if (clientToday !== null && clientToday >= DAILY_CONVERSATION_CAP) {
    return { allowed: false, reason: 'client_daily_cap' }
  }
  if (clientThisMonth !== null && clientThisMonth >= monthlyCap) {
    return { allowed: false, reason: 'client_monthly_cap' }
  }
  return { allowed: true }
}

// For the dashboard's usage-vs-plan-cap indicator.
export interface MonthlyUsage {
  used: number
  cap: number
  planName: string | null
}

export async function getMonthlyUsage(clientId: string): Promise<MonthlyUsage> {
  const [used, sub] = await Promise.all([
    countConversationsSince(startOfUtcMonth(), clientId),
    getSubscription(clientId)
  ])
  const plan = sub ? planForSubscription(sub.stripePriceId) : null
  // Display-only, so an unknown count shows as 0 rather than breaking the card.
  return { used: used ?? 0, cap: plan?.conversationCap ?? DEFAULT_MONTHLY_CAP, planName: plan?.name ?? null }
}
