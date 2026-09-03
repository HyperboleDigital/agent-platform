import { supabase } from './supabase'

// Platform-wide "AI spend this month" rollup for the superadmin Overview.
// Aggregates the three places the platform records LLM/vendor spend:
//   - chat:       message_logs.cost_micros  (migrate_2026-09-03_chat-cost.sql)
//   - generation: prospect_generation_runs.cost_micros (mockups, emails, images)
//   - seo jobs:   job_runs.cost_cents       (crawls, SERP checks, visibility legs)
// This is what the platform KNOWS it spent — provider consoles remain the
// authority for actual billing (and for anything priced 0 by lib/llm/pricing).
// Reads only; every leg degrades to zeros on query error (including the
// pre-migration missing-column case) rather than failing the endpoint.

export interface AiSpendModelRow {
  model: string
  messages: number
  inputTokens: number
  outputTokens: number
  costMicros: number
}

export interface AiSpend {
  month: string // YYYY-MM
  chat: { costMicros: number; messages: number; pendingMigration: boolean; byModel: AiSpendModelRow[] }
  generation: { costMicros: number; runs: number }
  seoJobs: { costCents: number; runs: number }
  totalUsd: number
}

function monthStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

export async function getAiSpend(): Promise<AiSpend> {
  const since = monthStart()
  const month = since.slice(0, 7)

  const [chatRes, genRes, jobRes] = await Promise.all([
    supabase.from('message_logs')
      .select('model, input_tokens, output_tokens, cost_micros')
      .gte('created_at', since)
      .not('cost_micros', 'is', null),
    supabase.from('prospect_generation_runs')
      .select('cost_micros')
      .gte('created_at', since),
    supabase.from('job_runs')
      .select('cost_cents')
      .gte('started_at', since)
  ])

  // Chat, grouped by model. A query error here is most likely the chat-cost
  // migration not being applied yet — surface that instead of a hard failure.
  const byModel = new Map<string, AiSpendModelRow>()
  let chatMicros = 0
  let chatMessages = 0
  if (!chatRes.error) {
    for (const r of chatRes.data ?? []) {
      const key = (r.model as string | null) ?? 'unknown'
      const row = byModel.get(key) ?? { model: key, messages: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 }
      row.messages++
      row.inputTokens += r.input_tokens ?? 0
      row.outputTokens += r.output_tokens ?? 0
      row.costMicros += Number(r.cost_micros ?? 0)
      byModel.set(key, row)
      chatMicros += Number(r.cost_micros ?? 0)
      chatMessages++
    }
  } else {
    console.warn('[ai-spend] chat leg unavailable (migration pending?):', chatRes.error.message)
  }

  if (genRes.error) console.error('[ai-spend] generation leg failed:', genRes.error.message)
  const genRows = genRes.error ? [] : (genRes.data ?? [])
  const genMicros = genRows.reduce((s, r) => s + Number(r.cost_micros ?? 0), 0)

  if (jobRes.error) console.error('[ai-spend] job leg failed:', jobRes.error.message)
  const jobRows = jobRes.error ? [] : (jobRes.data ?? [])
  const jobCents = jobRows.reduce((s, r) => s + Number(r.cost_cents ?? 0), 0)

  return {
    month,
    chat: {
      costMicros: chatMicros,
      messages: chatMessages,
      pendingMigration: !!chatRes.error,
      byModel: Array.from(byModel.values()).sort((a, b) => b.costMicros - a.costMicros)
    },
    generation: { costMicros: genMicros, runs: genRows.length },
    seoJobs: { costCents: jobCents, runs: jobRows.length },
    totalUsd: (chatMicros + genMicros) / 1_000_000 + jobCents / 100
  }
}
