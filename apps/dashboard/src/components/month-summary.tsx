import { useState } from 'react'
import useSWR from 'swr'
import { Link, useParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Sparkles, AlertTriangle } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

// "This month" panel (handoff #3 §3): the retainer-justification view. Leads
// with wins (results-ladder framing), plain language, month picker. The
// superadmin additionally sees the `attention` task list. Only rendered for
// seo-entitled clients (the parent gates).

function fmtMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

function shiftMonth(m: string, delta: number): string {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(Date.UTC(y, mo - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function pct(n: number | null): string {
  return n == null ? '—' : `${Math.round(n * 100)}%`
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'ChatGPT', anthropic: 'Claude', perplexity: 'Perplexity', google_aio: 'Google AI Overviews',
}

export function MonthSummaryCard({ clientId, isSuperadmin }: { clientId: string; isSuperadmin: boolean }) {
  const { slug = '' } = useParams()
  const thisMonth = new Date().toISOString().slice(0, 7)
  const [month, setMonth] = useState(thisMonth)
  const { data: s } = useSWR(['month-summary', clientId, month], () => api.clients.monthSummary(clientId, month))

  if (!s) return null

  const wins: string[] = []
  if (s.siteHealth.issuesFixed > 0) wins.push(`${s.siteHealth.issuesFixed} site issue${s.siteHealth.issuesFixed === 1 ? '' : 's'} fixed and confirmed`)
  if (s.siteHealth.delta != null && s.siteHealth.delta > 0) wins.push(`Site health up ${s.siteHealth.delta} points`)
  if (s.keywords.newTop10.length > 0) wins.push(`${s.keywords.newTop10.length} keyword${s.keywords.newTop10.length === 1 ? '' : 's'} entered Google's top 10`)
  else if (s.keywords.movedUp.length > 0) wins.push(`${s.keywords.movedUp.length} keyword${s.keywords.movedUp.length === 1 ? '' : 's'} moved up on Google`)
  if (s.visibility.newlyCited.length > 0) wins.push(`AI engines started citing you for ${s.visibility.newlyCited.length} new question${s.visibility.newlyCited.length === 1 ? '' : 's'}`)
  if (s.content.published.length > 0) wins.push(`${s.content.published.length} new page${s.content.published.length === 1 ? '' : 's'} published`)
  if (s.requestsClosed > 0) wins.push(`${s.requestsClosed} request${s.requestsClosed === 1 ? '' : 's'} completed`)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> This month</CardTitle>
        <div className="flex items-center gap-1 text-sm">
          <Button size="sm" variant="ghost" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <span className="w-32 text-center text-muted-foreground">{fmtMonth(month)}</span>
          <Button size="sm" variant="ghost" disabled={month >= thisMonth} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        {isSuperadmin && s.attention.length > 0 && (
          <div className="rounded-md border border-warning/50 bg-warning/5 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warning">
              <AlertTriangle className="h-3.5 w-3.5" /> Needs attention (superadmin)
            </p>
            <ul className="flex flex-col gap-1">
              {s.attention.map((a, i) => (
                <li key={i} className="text-sm">
                  <Link to={`/clients/${slug}/${a.section}`} className="underline underline-offset-2 hover:text-foreground">{a.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {wins.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {wins.map((w, i) => (
              <li key={i} className="flex items-center gap-2 text-sm"><TrendingUp className="h-4 w-4 shrink-0 text-success" /> {w}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Work in progress — results appear here as audits, rankings, and AI-visibility checks accumulate this month.</p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Site health</p>
            <p className="text-xl font-semibold">
              {s.siteHealth.score != null ? `${Math.round(s.siteHealth.score)}/100` : '—'}
              {s.siteHealth.delta != null && s.siteHealth.delta !== 0 && (
                <span className={`ml-2 text-sm ${s.siteHealth.delta > 0 ? 'text-success' : 'text-destructive'}`}>
                  {s.siteHealth.delta > 0 ? '+' : ''}{s.siteHealth.delta}
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">{s.siteHealth.issuesFixed} fixed · {s.siteHealth.issuesOpen} open</p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">Keywords tracked</p>
            <p className="text-xl font-semibold">{s.keywords.tracked}</p>
            <p className="text-xs text-muted-foreground">
              {s.keywords.movedUp.length > 0 && <span className="text-success">▲ {s.keywords.movedUp.length}</span>}
              {s.keywords.movedUp.length > 0 && s.keywords.movedDown.length > 0 && ' · '}
              {s.keywords.movedDown.length > 0 && <span className="text-destructive">▼ {s.keywords.movedDown.length}</span>}
              {s.keywords.movedUp.length === 0 && s.keywords.movedDown.length === 0 && 'holding steady'}
            </p>
          </div>
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted-foreground">AI mention rate</p>
            <p className="text-xl font-semibold">
              {pct(s.visibility.mentionRate)}
              {s.visibility.delta != null && s.visibility.delta !== 0 && (
                <span className={`ml-2 text-sm ${s.visibility.delta > 0 ? 'text-success' : 'text-destructive'}`}>
                  {s.visibility.delta > 0 ? '+' : ''}{Math.round(s.visibility.delta * 100)}%
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {Object.entries(s.visibility.byProvider).map(([p, v]) => `${PROVIDER_LABELS[p] ?? p} ${Math.round(v.mentionRate * 100)}%`).join(' · ') || 'no checks yet'}
            </p>
          </div>
        </div>

        {(s.keywords.movedUp.length > 0 || s.keywords.newTop10.length > 0) && (
          <div className="text-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Keyword movers</p>
            <ul className="flex flex-col gap-0.5">
              {s.keywords.movedUp.slice(0, 5).map((k, i) => (
                <li key={i} className="flex items-center gap-2">
                  <TrendingUp className="h-3.5 w-3.5 text-success" /> {k.keyword}
                  <span className="text-xs text-muted-foreground">#{k.from ?? '100+'} → #{k.to ?? '100+'}</span>
                  {s.keywords.newTop10.some(t => t.keyword === k.keyword) && <Badge variant="success">top 10</Badge>}
                </li>
              ))}
              {s.keywords.movedDown.slice(0, 3).map((k, i) => (
                <li key={i} className="flex items-center gap-2 text-muted-foreground">
                  <TrendingDown className="h-3.5 w-3.5 text-destructive" /> {k.keyword}
                  <span className="text-xs">#{k.from ?? '100+'} → #{k.to ?? '100+'}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {s.visibility.citedInstead.length > 0 && (
          <div className="text-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Who&apos;s getting cited instead</p>
            <p className="text-muted-foreground">{s.visibility.citedInstead.map(d => `${d.domain} (${d.count})`).join(' · ')}</p>
          </div>
        )}

        {(s.content.published.length > 0 || s.content.inReview.length > 0 || s.content.quotaCap > 0) && (
          <div className="text-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Content{s.content.quotaCap > 0 && ` · ${s.content.quotaUsed}/${s.content.quotaCap} this month`}
            </p>
            <ul className="flex flex-col gap-0.5">
              {s.content.published.map((p, i) => <li key={i}>✓ {p.title} <span className="text-xs text-muted-foreground">({p.keyword})</span></li>)}
              {s.content.inReview.map((p, i) => <li key={`r${i}`} className="text-muted-foreground">◦ {p.title} — in review</li>)}
            </ul>
          </div>
        )}

        {s.unansweredQuestions.length > 0 && (
          <div className="text-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Questions your customers are asking</p>
            <ul className="flex flex-col gap-0.5 text-muted-foreground">
              {s.unansweredQuestions.slice(0, 5).map((q, i) => (
                <li key={i}>&ldquo;{q.question}&rdquo; <span className="text-xs">×{q.count}</span></li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">These feed next month&apos;s content plan — pages that answer real customer questions.</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
