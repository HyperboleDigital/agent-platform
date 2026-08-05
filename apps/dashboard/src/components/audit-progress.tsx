import { useState } from 'react'
import { ArrowDown, ArrowUp, Check, Minus } from 'lucide-react'
import type { CrawlTrendPoint } from '@/lib/api'
import { diffAudits, isEmptyDiff, scopeChanged, type CheckDelta } from '@/lib/audit-history'

// Progress-over-time view for the SEO audit: how the two scores have moved
// since the first audit, and — more usefully — exactly which checks changed.
// The score is the headline; the per-check diff is the evidence.

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function Delta({ value }: { value: number }) {
  if (value === 0) return <span className="text-muted-foreground">no change</span>
  const up = value > 0
  return (
    <span className={up ? 'text-success' : 'text-destructive'}>
      {up ? '+' : ''}{value}
    </span>
  )
}

// Fixed 0-100 domain rather than fitting the line to the data range. An
// auto-fitted axis turns a 2-point wobble into a dramatic climb, which is
// exactly the sort of chart that erodes trust when a client notices.
function Sparkline({ points, pick, className }: {
  points: CrawlTrendPoint[]
  pick: (p: CrawlTrendPoint) => number | null
  className: string
}) {
  const vals = points.map(pick)
  // Two points draw a single straight segment — no shape, no information, and
  // it reads as a horizontal rule rather than a chart. Wait for a third audit.
  if (vals.filter(v => v != null).length < 3) return null
  const w = 100
  const h = 28
  const step = points.length > 1 ? w / (points.length - 1) : 0
  const d = vals
    .map((v, i) => (v == null ? null : `${i * step},${h - (v / 100) * h}`))
    .filter(Boolean)
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={`h-7 w-full ${className}`} aria-hidden>
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function ScoreTrend({ label, points, pick, hint }: {
  label: string
  points: CrawlTrendPoint[]
  pick: (p: CrawlTrendPoint) => number | null
  hint: string
}) {
  const withVal = points.filter(p => pick(p) != null)
  if (withVal.length < 2) return null
  const first = Math.round(pick(withVal[0])!)
  const last = Math.round(pick(withVal[withVal.length - 1])!)
  return (
    <div className="min-w-[200px] flex-1 rounded-lg border border-border bg-card px-4 py-3">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-2 text-sm">
        <span className="text-muted-foreground">{first}</span>
        <span className="text-muted-foreground">→</span>
        <span className="text-xl font-semibold leading-none">{last}</span>
        <Delta value={last - first} />
      </div>
      {/* Colour tracks the actual direction — a flat score must not read green. */}
      <Sparkline
        points={points}
        pick={pick}
        className={last === first ? 'text-muted-foreground' : last > first ? 'text-success' : 'text-destructive'}
      />
      <div className="text-[11px] leading-tight text-muted-foreground">{hint}</div>
    </div>
  )
}

function DeltaList({ title, items, tone, icon }: {
  title: string
  items: CheckDelta[]
  tone: string
  icon: React.ReactNode
}) {
  if (!items.length) return null
  return (
    <div>
      <div className={`mb-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide ${tone}`}>
        {icon}
        {title} · {items.length}
      </div>
      <div className="flex flex-col gap-1">
        {items.map(d => (
          <div key={d.key} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate">{d.label}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {d.from} → {d.to} page{d.to === 1 ? '' : 's'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function AuditProgress({ points }: { points: CrawlTrendPoint[] }) {
  // Comparing an audit to itself is meaningless, and a single audit is a
  // starting line, not a trend.
  const [baseline, setBaseline] = useState<'first' | 'previous'>('first')
  if (points.length < 2) return null

  const latest = points[points.length - 1]
  const from = baseline === 'first' ? points[0] : points[points.length - 2]
  const diff = diffAudits(from, latest)
  const scope = scopeChanged(from, latest)

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Progress</h3>
          <p className="text-xs text-muted-foreground">
            {points.length} audits · first on {fmtDate(points[0].createdAt)}, latest {fmtDate(latest.createdAt)}
          </p>
        </div>
        <div className="flex rounded-md border border-border p-0.5 text-xs">
          {(['first', 'previous'] as const).map(b => (
            <button
              key={b}
              type="button"
              onClick={() => setBaseline(b)}
              className={`rounded px-2.5 py-1 ${baseline === b ? 'bg-muted font-medium' : 'text-muted-foreground'}`}
            >
              vs {b} audit
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <ScoreTrend
          label="Technical Health"
          points={points}
          pick={p => p.onpageScore}
          hint="On-page issues only — not keywords or rankings"
        />
        <ScoreTrend
          label="AI Search Health"
          points={points}
          pick={p => p.aiSearchScore}
          hint="Whether AI engines can crawl and read the site"
        />
      </div>

      {scope && (
        <p className="rounded-md border border-dashed border-border p-2.5 text-xs text-muted-foreground">
          Crawl scope changed between these audits ({from.pagesCrawled} → {latest.pagesCrawled} pages), so the
          scores are computed over different page sets. The per-check changes below are unaffected.
        </p>
      )}

      <div>
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          What changed since the {baseline === 'first' ? 'first' : 'previous'} audit
        </div>
        {isEmptyDiff(diff) ? (
          <p className="text-sm text-muted-foreground">
            No checks changed between these two audits.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <DeltaList title="Fixed" items={diff.fixed} tone="text-success" icon={<Check className="h-3.5 w-3.5" />} />
            <DeltaList title="Improved" items={diff.improved} tone="text-success" icon={<ArrowDown className="h-3.5 w-3.5" />} />
            <DeltaList title="New" items={diff.appeared} tone="text-destructive" icon={<ArrowUp className="h-3.5 w-3.5" />} />
            <DeltaList title="Worse" items={diff.worsened} tone="text-destructive" icon={<ArrowUp className="h-3.5 w-3.5" />} />
            {diff.unchanged.length > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Minus className="h-3.5 w-3.5" />
                {diff.unchanged.length} check{diff.unchanged.length === 1 ? '' : 's'} unchanged
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
