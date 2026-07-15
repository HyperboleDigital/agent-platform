import { useState } from 'react'
import type { SeoCrawl } from '@/lib/api'
import { Badge, StatusDot } from '@/components/ui/badge'

export function severityVariant(s: 'high' | 'medium' | 'low'): 'destructive' | 'warning' | 'success' {
  return s === 'high' ? 'destructive' : s === 'medium' ? 'warning' : 'success'
}

// Shows the exact pages an issue affects (the agency-spreadsheet "which pages"
// column), truncated with an expander so a 10-page issue doesn't flood the view.
function AffectedUrls({ urls }: { urls: string[] }) {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? urls : urls.slice(0, 5)
  const path = (u: string) => { try { return new URL(u).pathname || '/' } catch { return u } }
  return (
    <div className="mt-1.5 flex flex-col gap-0.5">
      {shown.map(u => (
        <a key={u} href={u} target="_blank" rel="noreferrer" className="truncate text-xs text-muted-foreground hover:text-foreground hover:underline">
          {path(u)}
        </a>
      ))}
      {urls.length > 5 && (
        <button type="button" onClick={() => setExpanded(v => !v)} className="self-start text-xs text-muted-foreground hover:text-foreground">
          {expanded ? 'Show less' : `+${urls.length - 5} more`}
        </button>
      )}
    </div>
  )
}

// Presentational: /100 health score + meta + prioritized issues (or raw-check
// fallback). Shared by the client Site Health card and the superadmin Audit Tool.
export function CrawlResults({ crawl }: { crawl: SeoCrawl }) {
  const issues = crawl.issues ?? null
  const ai = crawl.aiSearch
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-6">
        {crawl.onpageScore != null && (
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-semibold">{Math.round(crawl.onpageScore)}</span>
            <span className="text-sm text-muted-foreground">/ 100 site health</span>
          </div>
        )}
        {ai && (
          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-semibold">{ai.score}</span>
            <span className="text-sm text-muted-foreground">/ 100 AI search health</span>
          </div>
        )}
        <div className="text-xs text-muted-foreground">
          {crawl.pagesCrawled != null && <>{crawl.pagesCrawled} pages crawled</>}
          {crawl.cost != null && <> · ${crawl.cost.toFixed(3)} crawl cost</>}
        </div>
      </div>

      {ai && ai.issues.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/20 p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">AI Search / GEO</div>
          {ai.issues.map((iss, i) => (
            <div key={i} className="flex items-start gap-3">
              <Badge variant={severityVariant(iss.severity)}>
                <StatusDot variant={severityVariant(iss.severity)} />{iss.severity}
              </Badge>
              <div className="min-w-0">
                <div className="text-sm font-medium">{iss.title}</div>
                <div className="text-xs text-muted-foreground">{iss.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {issues && issues.length > 0 ? (
        <div className="flex flex-col gap-2">
          {issues.map((iss, i) => (
            <div key={i} className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3">
              <Badge variant={severityVariant(iss.severity)}>
                <StatusDot variant={severityVariant(iss.severity)} />{iss.severity}
              </Badge>
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {iss.title}{iss.count ? <span className="text-muted-foreground"> · {iss.count}</span> : null}
                </div>
                <div className="text-xs text-muted-foreground">{iss.explanation}</div>
                {iss.urls && iss.urls.length > 0 && <AffectedUrls urls={iss.urls} />}
              </div>
            </div>
          ))}
        </div>
      ) : crawl.checks && crawl.checks.length > 0 ? (
        // Fallback if issue synthesis was unavailable (e.g. low LLM credits):
        // still show the raw problem counts so the audit isn't empty.
        <div className="flex flex-col gap-1.5">
          {crawl.checks.map(c => (
            <div key={c.key} className="flex items-center justify-between text-sm">
              <span>{c.label}</span>
              <span className="text-muted-foreground">{c.count}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No significant issues found — nice.</p>
      )}
    </div>
  )
}
