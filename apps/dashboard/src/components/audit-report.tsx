import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { SeoCrawl } from '@/lib/api'
import { Badge, StatusDot } from '@/components/ui/badge'
import { buildAuditRows, groupByCategory, SEVERITY_RANK, type AuditRow, type Severity } from '@/lib/audit-rows'

// SEMrush-style audit view: score gauges, a category breakdown, and an
// expandable issue list (click a row → explanation + the exact affected URLs).
// Shared by the standalone Audit Tool and the client SEO tab — the single audit
// view across the app.

function severityVariant(s: Severity): 'destructive' | 'warning' | 'success' {
  return s === 'high' ? 'destructive' : s === 'medium' ? 'warning' : 'success'
}

function scoreColor(score: number): string {
  if (score >= 90) return 'text-success'
  if (score >= 50) return 'text-warning'
  return 'text-destructive'
}
function barColor(score: number): string {
  if (score >= 90) return 'bg-success'
  if (score >= 50) return 'bg-warning'
  return 'bg-destructive'
}

function ScoreCard({ label, score }: { label: string; score: number }) {
  const s = Math.round(score)
  return (
    <div className="min-w-[190px] rounded-lg border border-border bg-card px-5 py-4">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className={`text-4xl font-semibold leading-none ${scoreColor(score)}`}>{s}</span>
        <span className="text-sm text-muted-foreground">/100</span>
      </div>
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${barColor(score)}`} style={{ width: `${s}%` }} />
      </div>
    </div>
  )
}

function IssueRow({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false)
  const path = (u: string) => { try { return new URL(u).pathname || '/' } catch { return u } }
  return (
    <div className="border-b border-border last:border-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-3 py-2.5 text-left"
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
        <Badge variant={severityVariant(row.severity)}><StatusDot variant={severityVariant(row.severity)} />{row.severity}</Badge>
        <span className="flex-1 truncate text-sm font-medium">{row.title}</span>
        {row.count > 0 && <span className="shrink-0 text-xs text-muted-foreground">{row.count} page{row.count === 1 ? '' : 's'}</span>}
      </button>
      {open && (
        <div className="pb-3 pl-10 pr-3">
          <p className="text-xs text-muted-foreground">{row.detail}</p>
          {row.urls.length > 0 && (
            <div className="mt-2 flex flex-col gap-0.5">
              <span className="text-xs font-medium">Affected pages</span>
              {row.urls.map(u => (
                <a key={u} href={u} target="_blank" rel="noreferrer" className="truncate text-xs text-muted-foreground hover:text-foreground hover:underline">
                  {path(u)}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// `showCost` surfaces the internal DataForSEO crawl cost — only for internal
// views (the Audit Tool, or a superadmin looking at a client). Off by default so
// it never leaks into the client-facing portal.
export function AuditReport({ crawl, showCost = false }: { crawl: SeoCrawl; showCost?: boolean }) {
  const rows = buildAuditRows(crawl)
  const categories = groupByCategory(rows)

  return (
    <div className="flex flex-col gap-5">
      {/* Score gauges */}
      <div className="flex flex-wrap items-center gap-3">
        {crawl.onpageScore != null && <ScoreCard label="Site Health" score={crawl.onpageScore} />}
        {crawl.aiSearch && <ScoreCard label="AI Search Health" score={crawl.aiSearch.score} />}
        <div className="text-xs text-muted-foreground">
          {crawl.pagesCrawled != null && <div>{crawl.pagesCrawled} pages crawled</div>}
          {showCost && crawl.cost != null && <div>${crawl.cost.toFixed(3)} crawl cost</div>}
          <div>{rows.length} issue{rows.length === 1 ? '' : 's'} found</div>
        </div>
      </div>

      {/* Category breakdown */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {categories.map(([cat, rs]) => {
            const worst = rs.reduce<Severity>((w, r) => (SEVERITY_RANK[r.severity] > SEVERITY_RANK[w] ? r.severity : w), 'low')
            return (
              <div key={cat} className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm">
                <StatusDot variant={severityVariant(worst)} />
                <span>{cat}</span>
                <span className="text-muted-foreground">{rs.length}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Grouped, expandable issues */}
      {categories.length > 0 ? (
        <div className="flex flex-col gap-4">
          {categories.map(([cat, rs]) => (
            <div key={cat} className="rounded-lg border border-border">
              <div className="border-b border-border bg-muted/30 px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {cat} · {rs.length}
              </div>
              <div className="px-3">
                {rs.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]).map((r, i) => (
                  <IssueRow key={`${cat}-${i}`} row={r} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No significant issues found — nice.</p>
      )}
    </div>
  )
}
