import { supabase } from './supabase'

// Progress + cost bookkeeping for a one-click concept generation run.
//
// A full run is scrape -> design analysis -> layout image -> stock photos ->
// HTML -> layout audit: several minutes, four provider calls, two providers.
// Holding an HTTP request open for that (which the old per-step buttons did)
// is fragile behind a proxy and tells the operator nothing while it runs.
// So a run is a row: the job writes progress into it, the dashboard polls it.
// Same background-job shape seo_crawls already uses, rather than adding SSE
// or a websocket for a single feature.
//
// Nothing here calls a provider — this module only records. The orchestration
// lives in prospect-mockups.ts next to the generation steps it drives.

export type RunStatus = 'running' | 'done' | 'error'
export type StepStatus = 'pending' | 'running' | 'done' | 'skipped' | 'error'

export interface RunStep {
  key: string
  label: string
  status: StepStatus
  // 0-100 within this step. Most steps can't report real sub-progress (one
  // provider call that either returns or doesn't), so this is driven by
  // elapsed time against a typical duration — see tickStep. It exists to show
  // the operator that something is still happening, not to be an estimate.
  pct: number
  detail?: string
}

export interface CostItem {
  step: string
  provider: string
  model: string
  kind: 'tokens' | 'image'
  qty: number
  micros: number
}

export interface GenerationRun {
  id: string
  prospectId: string
  status: RunStatus
  steps: RunStep[]
  currentStep: string | null
  mockupId: string | null
  costMicros: number
  costDetail: CostItem[]
  options: Record<string, unknown>
  error: string | null
  createdAt: string
  finishedAt: string | null
}

interface Row {
  id: string
  prospect_id: string
  status: RunStatus
  steps: RunStep[] | null
  current_step: string | null
  mockup_id: string | null
  cost_micros: number | string
  cost_detail: CostItem[] | null
  options: Record<string, unknown> | null
  error: string | null
  created_at: string
  finished_at: string | null
}

function fromRow(r: Row): GenerationRun {
  return {
    id: r.id,
    prospectId: r.prospect_id,
    status: r.status,
    steps: r.steps ?? [],
    currentStep: r.current_step,
    mockupId: r.mockup_id,
    // bigint comes back as a string from PostgREST once it exceeds the JS safe
    // integer range; Number() here is safe because a run's cost is cents, not
    // billions of micros, but parsing rather than trusting the type keeps it
    // honest if that ever changes.
    costMicros: typeof r.cost_micros === 'string' ? Number(r.cost_micros) : r.cost_micros,
    costDetail: r.cost_detail ?? [],
    options: r.options ?? {},
    error: r.error,
    createdAt: r.created_at,
    finishedAt: r.finished_at,
  }
}

// Two kinds of run share this table: building the concept, and preparing the
// outreach email. They're the same shape (ordered steps, per-step cost, one
// live job per prospect) and the dashboard polls them identically, so a second
// table would be duplication. The kind lives inside `options` rather than in a
// column of its own purely to avoid a migration for what is one discriminator
// — `options` is already jsonb and already per-run.
export type RunKind = 'concept' | 'email'

export async function createRun(
  prospectId: string,
  steps: RunStep[],
  options: Record<string, unknown>,
  kind: RunKind = 'concept'
): Promise<GenerationRun> {
  const { data, error } = await supabase
    .from('prospect_generation_runs')
    .insert({
      prospect_id: prospectId,
      steps,
      options: { ...options, kind },
      status: 'running',
      current_step: steps[0]?.key ?? null,
    })
    .select()
    .single()
  if (error) throw new Error(`Failed to create generation run: ${error.message}`)
  return fromRow(data as Row)
}

export async function getRun(id: string): Promise<GenerationRun | null> {
  const { data, error } = await supabase.from('prospect_generation_runs').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(`Failed to load generation run: ${error.message}`)
  return data ? fromRow(data as Row) : null
}

// The run the dashboard should be watching for this prospect: the newest one,
// whatever its state, so a finished run's cost and findings stay on screen
// instead of vanishing the moment it completes.
export async function latestRun(prospectId: string, kind: RunKind = 'concept'): Promise<GenerationRun | null> {
  let query = supabase
    .from('prospect_generation_runs')
    .select('*')
    .eq('prospect_id', prospectId)
  // Runs created before the kind discriminator existed are all concept runs,
  // so a null kind has to count as 'concept' — filtering on equality alone
  // would silently hide every run that predates this.
  query = kind === 'concept'
    ? query.or('options->>kind.is.null,options->>kind.eq.concept')
    : query.eq('options->>kind', kind)
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Failed to load generation runs: ${error.message}`)
  return data ? fromRow(data as Row) : null
}

// A live handle over one run row. Writes go straight to the DB on each update
// so the dashboard's poll sees them; the in-memory copy exists only so a
// caller doesn't have to re-read the row to amend one field.
export class RunTracker {
  private steps: RunStep[]
  private cost: CostItem[] = []
  private timer: NodeJS.Timeout | null = null

  constructor(readonly runId: string, steps: RunStep[]) {
    this.steps = steps.map(s => ({ ...s }))
  }

  private async persist(patch: Record<string, unknown> = {}): Promise<void> {
    const { error } = await supabase
      .from('prospect_generation_runs')
      .update({ steps: this.steps, ...patch })
      .eq('id', this.runId)
    // A progress write failing must never abort a run that is otherwise fine
    // and has already spent money — the operator loses the progress bar, not
    // the concept.
    if (error) console.error('[generation-run] progress write failed:', error.message)
  }

  private step(key: string): RunStep | undefined {
    return this.steps.find(s => s.key === key)
  }

  // Most steps are a single provider call with no sub-progress to report, so
  // the bar advances on a timer toward 90% over the step's typical duration
  // and only reaches 100% when the step actually finishes. It deliberately
  // never implies completion it can't observe.
  async begin(key: string, typicalMs: number, detail?: string): Promise<void> {
    const step = this.step(key)
    if (!step) return
    step.status = 'running'
    step.pct = 0
    if (detail) step.detail = detail
    await this.persist({ current_step: key })

    const startedAt = Date.now()
    this.clearTimer()
    this.timer = setInterval(() => {
      const s = this.step(key)
      if (!s || s.status !== 'running') return this.clearTimer()
      s.pct = Math.min(90, Math.round(((Date.now() - startedAt) / typicalMs) * 90))
      void this.persist()
    }, 1500)
  }

  async finish(key: string, detail?: string): Promise<void> {
    this.clearTimer()
    const step = this.step(key)
    if (!step) return
    step.status = 'done'
    step.pct = 100
    if (detail) step.detail = detail
    await this.persist()
  }

  async skip(key: string, detail: string): Promise<void> {
    this.clearTimer()
    const step = this.step(key)
    if (!step) return
    step.status = 'skipped'
    step.pct = 100
    step.detail = detail
    await this.persist()
  }

  async fail(key: string, message: string): Promise<void> {
    this.clearTimer()
    const step = this.step(key)
    if (step) {
      step.status = 'error'
      step.detail = message
    }
    await this.persist()
  }

  // Costs accumulate as they're incurred rather than being totalled at the
  // end, so a run that dies halfway still shows the operator what it spent.
  async addCost(item: CostItem): Promise<void> {
    this.cost.push(item)
    const total = this.cost.reduce((sum, c) => sum + c.micros, 0)
    const { error } = await supabase
      .from('prospect_generation_runs')
      .update({ cost_micros: total, cost_detail: this.cost })
      .eq('id', this.runId)
    if (error) console.error('[generation-run] cost write failed:', error.message)
  }

  async complete(mockupId: string | null): Promise<void> {
    this.clearTimer()
    await this.persist({ status: 'done', mockup_id: mockupId, finished_at: new Date().toISOString() })
  }

  async abort(message: string): Promise<void> {
    this.clearTimer()
    await this.persist({ status: 'error', error: message, finished_at: new Date().toISOString() })
  }

  private clearTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}

// A process restart mid-run would otherwise leave a row saying 'running'
// forever, and the dashboard would poll it indefinitely. Called at boot,
// same posture as finalizePendingCrawls().
export async function failOrphanedRuns(): Promise<void> {
  const { error } = await supabase
    .from('prospect_generation_runs')
    .update({
      status: 'error',
      error: 'Interrupted — the API restarted while this run was in progress.',
      finished_at: new Date().toISOString(),
    })
    .eq('status', 'running')
  if (error) console.error('[generation-run] failed to clear orphaned runs:', error.message)
}
