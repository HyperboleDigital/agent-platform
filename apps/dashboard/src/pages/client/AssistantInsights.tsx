import { useMemo, useState } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Download, MessageSquare, HelpCircle, AlertTriangle, BookOpen, SlidersHorizontal } from 'lucide-react'
import type { AnalyticsQuery, HeadlineMetric } from '@/lib/api'
import { DEFAULT_CONFIDENCE_THRESHOLD, type Client, type BusinessHours } from '@agent-platform/shared'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { EmptyState } from '@/components/empty-state'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { ConversationsLeadsChart, EscalationsChart } from '@/components/charts/insights-charts'

// ── formatting ────────────────────────────────────────────────────────────────
const fmtInt = (n: number) => n.toLocaleString()
const fmtPct = (n: number) => `${Math.round(n * 100)}%`

// ── range picker ──────────────────────────────────────────────────────────────
type RangeState =
  | { kind: 'preset'; days: number }
  | { kind: 'custom'; from: string; to: string }

function toQuery(r: RangeState): AnalyticsQuery {
  return r.kind === 'preset' ? { range: r.days } : { from: r.from, to: r.to }
}
// Stable string for SWR keys, so the fetch re-runs when the range changes.
function rangeKey(r: RangeState): string {
  return r.kind === 'preset' ? `p${r.days}` : `c${r.from}:${r.to}`
}

function RangePicker({ value, onChange }: { value: RangeState; onChange: (r: RangeState) => void }) {
  const presets = [7, 30, 90]
  const isCustom = value.kind === 'custom'
  const today = new Date().toISOString().slice(0, 10)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
        {presets.map(d => (
          <button
            key={d}
            type="button"
            onClick={() => onChange({ kind: 'preset', days: d })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${value.kind === 'preset' && value.days === d ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {d}d
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange({ kind: 'custom', from: today, to: today })}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${isCustom ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
        >
          Custom
        </button>
      </div>
      {isCustom && (
        <div className="flex items-center gap-1.5 text-sm">
          <input
            type="date"
            value={value.from}
            max={value.to}
            onChange={e => onChange({ ...value, from: e.target.value })}
            className="rounded-md border border-border bg-background px-2 py-1"
          />
          <span className="text-muted-foreground">→</span>
          <input
            type="date"
            value={value.to}
            min={value.from}
            max={today}
            onChange={e => onChange({ ...value, to: e.target.value })}
            className="rounded-md border border-border bg-background px-2 py-1"
          />
        </div>
      )}
    </div>
  )
}

// ── headline stat card with % change vs previous period ──────────────────────
function StatCard({ label, metric, format, loading }: {
  label: string
  metric: HeadlineMetric | undefined
  format: (n: number) => string
  loading: boolean
}) {
  const change = metric?.changePct ?? null
  const up = change !== null && change > 0
  const down = change !== null && change < 0
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {loading || !metric ? '—' : format(metric.value)}
      </div>
      {metric && (
        <div className="mt-1 flex items-center gap-1 text-xs">
          {change === null ? (
            <span className="text-muted-foreground">No prior period</span>
          ) : (
            <>
              <span className={`inline-flex items-center gap-0.5 font-medium ${up ? 'text-success' : down ? 'text-destructive' : 'text-muted-foreground'}`}>
                {up ? <ArrowUp className="h-3 w-3" /> : down ? <ArrowDown className="h-3 w-3" /> : null}
                {Math.abs(Math.round(change * 100))}%
              </span>
              <span className="text-muted-foreground">vs previous</span>
            </>
          )}
        </div>
      )}
    </Card>
  )
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  )
}

// ── behaviour settings (confidence threshold + business hours) ───────────────
const DEFAULT_HOURS: BusinessHours = { tz: 'America/New_York', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

function BehaviourSettings({ client }: { client: Client }) {
  const cfg = client.agentConfig ?? ({} as Client['agentConfig'])
  const [threshold, setThreshold] = useState<number>(cfg.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD)
  const [hours, setHours] = useState<BusinessHours>(cfg.businessHours ?? DEFAULT_HOURS)
  const [saving, setSaving] = useState(false)

  function toggleDay(d: number) {
    setHours(h => ({ ...h, days: h.days.includes(d) ? h.days.filter(x => x !== d) : [...h.days, d].sort() }))
  }

  async function save() {
    setSaving(true)
    try {
      // Send the FULL agentConfig — the API replaces the whole jsonb, so spread
      // the existing config first or unrelated fields (knowledge, escalation
      // email) would be wiped.
      await api.clients.upsert({
        id: client.id,
        agentConfig: { ...cfg, confidenceThreshold: threshold, businessHours: hours }
      })
      mutate(['client', client.id])
      toast.success('Assistant settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <SlidersHorizontal className="h-4 w-4 text-primary" /> Assistant behaviour
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5 pt-0">
        <div className="flex flex-col gap-1.5">
          <Label>Confidence threshold <span className="tabular-nums text-muted-foreground">({Math.round(threshold * 100)}%)</span></Label>
          <p className="text-xs text-muted-foreground">
            Below this knowledge-base match confidence, the assistant says it isn't sure and offers a human
            instead of guessing. Higher = more cautious (more hand-offs); lower = more self-service.
          </p>
          <input
            type="range" min={0} max={1} step={0.05}
            value={threshold}
            onChange={e => setThreshold(Number(e.target.value))}
            className="w-full max-w-xs accent-primary"
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label>Business hours <span className="text-muted-foreground">(for the after-hours coverage metric)</span></Label>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              {WEEKDAY_LABELS.map((lbl, d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => toggleDay(d)}
                  className={`h-8 w-8 rounded-md text-xs font-medium transition-colors ${hours.days.includes(d) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                  aria-label={`Toggle ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]}`}
                >
                  {lbl}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-sm">
              <input type="time" value={hours.start} onChange={e => setHours(h => ({ ...h, start: e.target.value }))} className="rounded-md border border-border bg-background px-2 py-1" />
              <span className="text-muted-foreground">to</span>
              <input type="time" value={hours.end} onChange={e => setHours(h => ({ ...h, end: e.target.value }))} className="rounded-md border border-border bg-background px-2 py-1" />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Time zone (IANA)</Label>
            <Input value={hours.tz} onChange={e => setHours(h => ({ ...h, tz: e.target.value }))} placeholder="America/New_York" className="max-w-xs" />
          </div>
        </div>

        <Button onClick={save} disabled={saving} className="w-fit">{saving ? 'Saving…' : 'Save settings'}</Button>
      </CardContent>
    </Card>
  )
}

export function AssistantInsights({ clientId, client }: { clientId: string; client?: Client }) {
  const [range, setRange] = useState<RangeState>({ kind: 'preset', days: 30 })
  const q = useMemo(() => toQuery(range), [range])
  const key = rangeKey(range)
  const [exporting, setExporting] = useState(false)

  // Custom range needs both ends before we fetch.
  const ready = range.kind === 'preset' || (!!range.from && !!range.to && range.from <= range.to)

  const headline = useSWR(ready ? ['an-headline', clientId, key] : null, () => api.clients.analyticsHeadline(clientId, q))
  const trend = useSWR(ready ? ['an-trend', clientId, key] : null, () => api.clients.analyticsTimeseries(clientId, q))
  const questions = useSWR(ready ? ['an-questions', clientId, key] : null, () => api.clients.analyticsTopQuestions(clientId, q))
  const unanswered = useSWR(ready ? ['an-unanswered', clientId, key] : null, () => api.clients.analyticsUnanswered(clientId, q))
  const coverage = useSWR(ready ? ['an-coverage', clientId, key] : null, () => api.clients.analyticsCoverage(clientId, q))

  async function exportTranscript() {
    setExporting(true)
    try {
      await api.clients.exportTranscript(clientId, q, `transcript-${new Date().toISOString().slice(0, 10)}.csv`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  const h = headline.data
  const loadingH = headline.isLoading

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <RangePicker value={range} onChange={setRange} />
        <Button variant="outline" size="sm" onClick={exportTranscript} disabled={exporting}>
          <Download className="h-3.5 w-3.5" /> {exporting ? 'Exporting…' : 'Export transcripts (CSV)'}
        </Button>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Conversations handled" metric={h?.conversations} format={fmtInt} loading={loadingH} />
        <StatCard label="Leads captured" metric={h?.leads} format={fmtInt} loading={loadingH} />
        <StatCard label="Deflection rate" metric={h?.deflectionRate} format={fmtPct} loading={loadingH} />
        <StatCard label="After-hours coverage" metric={h?.afterHoursCoverage} format={fmtPct} loading={loadingH} />
      </div>

      {/* Trends */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Conversations & leads" subtitle="Daily volume — leads overlaid so you can see what traffic converts.">
          <ConversationsLeadsChart data={trend.data ?? []} />
        </ChartCard>
        <ChartCard title="Escalations" subtitle="Hand-offs to a human. This should trend down as the knowledge base grows.">
          <EscalationsChart data={trend.data ?? []} />
        </ChartCard>
      </div>

      {/* Unanswered — the most important view. */}
      <Card className="overflow-hidden p-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-warning" /> Unanswered & low-confidence questions
          </CardTitle>
          <p className="text-xs text-muted-foreground">Every question the assistant wasn't confident about or escalated — the list we work through to improve it.</p>
        </CardHeader>
        {unanswered.data?.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Question</TableHead>
                  <TableHead className="w-28">Confidence</TableHead>
                  <TableHead className="w-40">Outcome</TableHead>
                  <TableHead className="w-32">When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unanswered.data.map((u, i) => (
                  <TableRow key={i}>
                    <TableCell className="max-w-md">
                      <div className="truncate font-medium" title={u.question}>{u.question}</div>
                      {u.reason && <div className="truncate text-xs text-muted-foreground" title={u.reason}>{u.reason}</div>}
                    </TableCell>
                    <TableCell className="tabular-nums">{u.confidence === null ? '—' : fmtPct(u.confidence)}</TableCell>
                    <TableCell className="text-muted-foreground">{u.resolvedBy === 'human' ? 'Escalated to human' : u.resolvedBy ?? '—'}</TableCell>
                    <TableCell className="text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState icon={AlertTriangle} title="Nothing unanswered yet" description="Every question in this period was answered confidently. New low-confidence questions will show up here." />
        )}
      </Card>

      {/* Top questions */}
      <Card className="overflow-hidden p-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <HelpCircle className="h-4 w-4 text-primary" /> Top questions asked
          </CardTitle>
          <p className="text-xs text-muted-foreground">What visitors ask most — useful for content and SEO, not just support.</p>
        </CardHeader>
        {questions.data?.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Question</TableHead>
                  <TableHead className="w-20 text-right">Times asked</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {questions.data.map((c, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <div className="font-medium">{c.question}</div>
                      {c.examples.length > 0 && (
                        <div className="mt-0.5 text-xs text-muted-foreground">also: {c.examples.join(' · ')}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState icon={MessageSquare} title="No questions yet" description="Once visitors start chatting, their most common questions will cluster here." />
        )}
      </Card>

      {/* KB coverage */}
      <Card className="overflow-hidden p-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <BookOpen className="h-4 w-4 text-primary" /> Knowledge base coverage
          </CardTitle>
          <p className="text-xs text-muted-foreground">How often each document is used to answer. Zero means it may be stale or redundant.</p>
        </CardHeader>
        {coverage.data?.length ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Document</TableHead>
                  <TableHead className="w-24 text-right">Retrievals</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coverage.data.map(c => (
                  <TableRow key={c.documentId}>
                    <TableCell className="font-medium">{c.title}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.retrievals === 0
                        ? <span className="text-muted-foreground">Never used</span>
                        : c.retrievals}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState icon={BookOpen} title="No knowledge base documents" description="Add documents under the Knowledge base tab to see how often each is used." />
        )}
      </Card>

      {client && <BehaviourSettings client={client} />}
    </div>
  )
}
