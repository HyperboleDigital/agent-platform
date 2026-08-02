import type { ChatTurn } from './llm/types'

// Short-term conversation memory for the chat widget, so a visitor can ask a
// follow-up ("how much is that one?") and be understood.
//
// ── Why in-memory, and why the server owns it ────────────────────────────────
// History is reconstructed here rather than accepted from the client. The
// widget could send its own transcript, but then a caller could forge assistant
// turns ("you said we'd waive the fee") or pad the history to inflate token
// spend. Everything the model sees about the past therefore comes from what we
// actually said.
//
// It is deliberately NOT persisted to the database:
//   * message_logs stores only metrics (intent, duration, resolved) — no
//     message text. Adding history to Postgres would start storing visitors'
//     conversation content on behalf of clients, which is a privacy decision
//     for them to make, not a side effect of a follow-up-questions feature.
//   * The widget already forgets: SESSION_ID is regenerated on every page load
//     and its visible thread is in-memory. Persisting server-side would make
//     the model remember a conversation the visitor can no longer see.
//
// Trade-off: memory resets on deploy or restart, and this is single-instance
// only (same caveat as lib/rate-limit.ts). A mid-conversation deploy costs one
// visitor their context. Move to Redis if the API is ever scaled horizontally.

interface Session {
  turns: ChatTurn[]
  updatedAt: number
}

const sessions = new Map<string, Session>()

// Every bound below exists to cap tokens per request — history is re-sent on
// each call, so it is the one input a visitor can grow for free.
const MAX_TURNS = 8              // 4 exchanges; enough for follow-ups
const MAX_CHARS_PER_TURN = 1000  // matches the widget's practical reply length
const TTL_MS = 30 * 60_000       // a chat older than this is a new conversation
const MAX_SESSIONS = 5_000       // hard ceiling so this can't grow unbounded

const key = (clientId: string, from: string) => `${clientId}:${from}`

function truncate(s: string): string {
  return s.length <= MAX_CHARS_PER_TURN ? s : `${s.slice(0, MAX_CHARS_PER_TURN)}…`
}

export function getHistory(clientId: string, from: string): ChatTurn[] {
  const s = sessions.get(key(clientId, from))
  if (!s) return []
  if (Date.now() - s.updatedAt > TTL_MS) {
    sessions.delete(key(clientId, from))
    return []
  }
  return s.turns
}

export function appendTurn(clientId: string, from: string, userMessage: string, assistantReply: string): void {
  const k = key(clientId, from)
  const existing = sessions.get(k)
  const turns = existing && Date.now() - existing.updatedAt <= TTL_MS ? existing.turns : []

  turns.push({ role: 'user', content: truncate(userMessage) })
  turns.push({ role: 'assistant', content: truncate(assistantReply) })

  // Keep the most recent exchanges. Slicing in pairs keeps user/assistant
  // alternation intact, which both provider APIs expect.
  while (turns.length > MAX_TURNS) turns.splice(0, 2)

  sessions.set(k, { turns, updatedAt: Date.now() })

  // Evict the oldest session if we're over the ceiling. Only reachable under
  // heavy concurrent load, where dropping the stalest context is the right
  // failure: it degrades to today's behaviour rather than exhausting memory.
  if (sessions.size > MAX_SESSIONS) {
    let oldestKey: string | null = null
    let oldest = Infinity
    for (const [sk, sv] of sessions) {
      if (sv.updatedAt < oldest) { oldest = sv.updatedAt; oldestKey = sk }
    }
    if (oldestKey) sessions.delete(oldestKey)
  }
}

// Periodic sweep so ended conversations don't sit in memory until eviction.
const SWEEP_MS = 10 * 60_000
setInterval(() => {
  const now = Date.now()
  for (const [k, s] of sessions) {
    if (now - s.updatedAt > TTL_MS) sessions.delete(k)
  }
}, SWEEP_MS).unref()

// Test/ops seam — lets a verification script assert eviction and TTL without
// waiting on wall-clock time.
export function __clearAllSessions(): void {
  sessions.clear()
}
