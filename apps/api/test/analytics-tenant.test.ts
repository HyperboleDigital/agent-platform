import { describe, it, expect, vi } from 'vitest'
import { buildFakeSupabase } from './fake-supabase'

// Two tenants. Everything belonging to B is tagged with a distinctive marker so
// we can assert, bluntly, that none of it ever leaks into a query scoped to A.
// Hoisted so the seed exists before vi.mock's factory (which vi lifts to the
// top of the file) references it.
const { A, seed } = vi.hoisted(() => {
  const A = '00000000-0000-0000-0000-0000000000aa'
  const B = '00000000-0000-0000-0000-0000000000bb'
  const now = new Date().toISOString()
  const seed = {
  chat_sessions: [
    { client_id: A, session_id: 'A_SESS_1', started_at: now, escalated: false, outcome: 'resolved', lead_captured: false },
    { client_id: A, session_id: 'A_SESS_2', started_at: now, escalated: true, outcome: 'escalated', lead_captured: false },
    { client_id: B, session_id: 'B_SESS_LEAK', started_at: now, escalated: false, outcome: 'resolved', lead_captured: true },
    { client_id: B, session_id: 'B_SESS_LEAK_2', started_at: now, escalated: true, outcome: 'escalated', lead_captured: false }
  ],
  leads: [
    { client_id: A, email: 'a@ok.test', session_id: 'A_SESS_1', created_at: now },
    { client_id: B, email: 'b_leak@bad.test', session_id: 'B_SESS_LEAK', created_at: now }
  ],
  message_logs: [
    { client_id: A, channel: 'chat', created_at: now, user_message: 'A_QUESTION about pricing', assistant_response: 'sure', confidence: 0.2, escalated: false, escalation_reason: null, resolved_by: 'agent', retrieved_doc_ids: ['chunkA'], query_embedding: null, intent: 'faq' },
    { client_id: A, channel: 'chat', created_at: now, user_message: 'A_QUESTION escalate me', assistant_response: 'ok', confidence: null, escalated: true, escalation_reason: 'user asked', resolved_by: 'human', retrieved_doc_ids: [], query_embedding: null, intent: 'escalate' },
    { client_id: B, channel: 'chat', created_at: now, user_message: 'SECRET_B_QUESTION', assistant_response: 'leak', confidence: 0.2, escalated: true, escalation_reason: 'B secret', resolved_by: 'human', retrieved_doc_ids: ['chunkB'], query_embedding: null, intent: 'faq' }
  ],
  knowledge_base: [
    { id: 'chunkA', client_id: A, document_id: 'docA', title: 'A_DOC' },
    { id: 'chunkB', client_id: B, document_id: 'docB', title: 'B_DOC' }
  ]
  }
  return { A, seed }
})

vi.mock('../src/lib/supabase', () => ({ supabase: buildFakeSupabase(seed) }))
// getClientById is only used to resolve per-client config (business hours /
// threshold); stub it so the test doesn't pull in Clerk/env.
vi.mock('../src/lib/clients', () => ({
  getClientById: async (id: string) => ({ id, agentConfig: {} })
}))

import {
  getHeadline, getTimeseries, getTopQuestions, getUnanswered, getCoverage, getTranscriptCsv
} from '../src/lib/analytics'

const wideRange = { from: new Date('2020-01-01'), to: new Date(Date.now() + 24 * 60 * 60 * 1000) }

// Any string that would only be present if B's data leaked through.
const B_MARKERS = ['SECRET_B', 'B_DOC', 'B_SESS_LEAK', 'b_leak@bad.test', 'B secret', 'docB', 'chunkB']

function assertNoBLeak(payload: unknown) {
  const json = JSON.stringify(payload)
  for (const marker of B_MARKERS) {
    expect(json, `tenant B marker "${marker}" leaked into a tenant-A query`).not.toContain(marker)
  }
}

describe('analytics is scoped by client_id — no cross-tenant leakage', () => {
  it('getHeadline counts only tenant A conversations and leads', async () => {
    const h = await getHeadline(A, wideRange)
    expect(h.conversations.value).toBe(2)   // A_SESS_1 + A_SESS_2, never B's
    expect(h.leads.value).toBe(1)           // only a@ok.test
    // 1 of 2 A sessions escalated → 50% deflection.
    expect(h.deflectionRate.value).toBeCloseTo(0.5)
    assertNoBLeak(h)
  })

  it('getTimeseries aggregates only tenant A rows', async () => {
    const series = await getTimeseries(A, wideRange)
    expect(series.reduce((n, p) => n + p.conversations, 0)).toBe(2)
    expect(series.reduce((n, p) => n + p.leads, 0)).toBe(1)
    expect(series.reduce((n, p) => n + p.escalations, 0)).toBe(1)
    assertNoBLeak(series)
  })

  it('getTopQuestions returns only tenant A questions', async () => {
    const q = await getTopQuestions(A, wideRange)
    expect(q.length).toBeGreaterThan(0)
    expect(q.every(c => c.question.includes('A_QUESTION'))).toBe(true)
    assertNoBLeak(q)
  })

  it('getUnanswered returns only tenant A low-confidence/escalated turns', async () => {
    const u = await getUnanswered(A, wideRange)
    // Both A rows qualify (one confidence 0.2 < 0.35 default, one escalated); B's does not.
    expect(u.length).toBe(2)
    expect(u.every(e => e.question.includes('A_QUESTION'))).toBe(true)
    assertNoBLeak(u)
  })

  it('getCoverage lists only tenant A documents', async () => {
    const c = await getCoverage(A, wideRange)
    expect(c.map(d => d.title)).toEqual(['A_DOC'])
    expect(c[0].retrievals).toBe(1) // chunkA retrieved once by an A message
    assertNoBLeak(c)
  })

  it('getTranscriptCsv exports only tenant A messages', async () => {
    const csv = await getTranscriptCsv(A, wideRange)
    expect(csv).toContain('A_QUESTION')
    assertNoBLeak(csv)
  })

  it('a tenant with no data gets empty results, not a fallback to another tenant', async () => {
    const empty = '00000000-0000-0000-0000-0000000000cc'
    const h = await getHeadline(empty, wideRange)
    expect(h.conversations.value).toBe(0)
    expect(await getTopQuestions(empty, wideRange)).toEqual([])
    expect(await getCoverage(empty, wideRange)).toEqual([])
    assertNoBLeak(h)
  })
})
