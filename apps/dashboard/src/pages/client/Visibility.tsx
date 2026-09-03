import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { Bot, Plus, X, RefreshCw, Lightbulb } from 'lucide-react'
import { api, type VisibilitySuggestions } from '@/lib/api'
import { useSetupTarget } from '@/lib/use-setup-target'
import { useClientCtx } from '@/pages/client/ClientLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'
import { TrendChart } from '@/components/charts/trend-chart'

function QueriesCard({ clientId }: { clientId: string }) {
  const key = ['visibility-queries', clientId]
  const { data: queries } = useSWR(key, () => api.clients.visibilityQueries(clientId))
  const { data: me } = useSWR('me', api.me)
  const isSuperadmin = me?.isSuperadmin ?? false
  const [newQuery, setNewQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [runningAll, setRunningAll] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestions, setSuggestions] = useState<VisibilitySuggestions | null>(null)
  const target = useSetupTarget('visibilityQueries')

  async function add() {
    if (!newQuery.trim()) return
    setAdding(true)
    try {
      await api.clients.addVisibilityQuery(clientId, newQuery.trim())
      setNewQuery('')
      mutate(key)
      mutate(['setup-status', clientId])
      toast.success('Query added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add query')
    } finally {
      setAdding(false)
    }
  }

  async function suggest() {
    setSuggesting(true)
    try {
      setSuggestions(await api.clients.suggestVisibilitySetup(clientId))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to get suggestions')
    } finally {
      setSuggesting(false)
    }
  }

  async function addSuggested(query: string) {
    try {
      await api.clients.addVisibilityQuery(clientId, query)
      setSuggestions(s => s ? { ...s, queries: s.queries.filter(q => q.query !== query) } : s)
      mutate(key)
      mutate(['setup-status', clientId])
      toast.success('Query added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add query')
    }
  }

  async function applyBrandTerms(terms: string[]) {
    try {
      await api.clients.updateSeoConfig(clientId, { brandTerms: terms })
      mutate(['seo-config', clientId])
      mutate(['setup-status', clientId])
      toast.success('Brand terms saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save brand terms')
    }
  }

  async function remove(queryId: string) {
    try {
      await api.clients.removeVisibilityQuery(clientId, queryId)
      mutate(key)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove query')
    }
  }

  async function runAll() {
    setRunningAll(true)
    try {
      await api.clients.runVisibilityCheck(clientId)
      mutate(['visibility-runs', clientId])
      toast.success('Visibility check complete')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to run check')
    } finally {
      setRunningAll(false)
    }
  }

  return (
    <Card ref={target.ref} className={target.highlight}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Tracked queries</CardTitle>
        <div className="flex items-center gap-2">
          {isSuperadmin && (
            <Button variant="outline" size="sm" onClick={suggest} disabled={suggesting}>
              <Lightbulb className="h-3.5 w-3.5" /> {suggesting ? 'Thinking…' : 'Suggest queries'}
            </Button>
          )}
          <Button size="sm" onClick={runAll} disabled={runningAll || !queries?.length}>
            <RefreshCw className={`h-3.5 w-3.5 ${runningAll ? 'animate-spin' : ''}`} />
            {runningAll ? 'Checking…' : 'Run all'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="flex gap-2">
          <Input
            value={newQuery}
            onChange={e => setNewQuery(e.target.value)}
            placeholder='e.g. "best plumber in Austin"'
            onKeyDown={e => e.key === 'Enter' && add()}
          />
          <Button variant="secondary" onClick={add} disabled={adding}>
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>
        {suggestions && (
          <div className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3">
            <div className="text-xs font-medium text-muted-foreground">Suggested — click to add the ones worth tracking</div>
            {suggestions.brandTerms.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-xs text-muted-foreground">Brand terms:</span>
                <span>{suggestions.brandTerms.join(', ')}</span>
                <Button variant="secondary" size="sm" onClick={() => applyBrandTerms(suggestions.brandTerms)}>Apply</Button>
              </div>
            )}
            {suggestions.queries.map(s => (
              <div key={s.query} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <span className="flex items-center gap-2">
                  <Badge variant="secondary" className="shrink-0 capitalize">{s.intent}</Badge>
                  {s.query}
                </span>
                <Button variant="ghost" size="sm" onClick={() => addSuggested(s.query)}>
                  <Plus className="h-3.5 w-3.5" /> Add
                </Button>
              </div>
            ))}
            {suggestions.queries.length === 0 && (
              <div className="text-sm text-muted-foreground">All suggestions added — run &quot;Suggest queries&quot; again for more.</div>
            )}
          </div>
        )}
        {queries?.length ? (
          <div className="flex flex-col gap-1.5">
            {queries.map(q => (
              <div key={q.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                <span>{q.query}</span>
                <button onClick={() => remove(q.id)} className="text-muted-foreground hover:text-destructive">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Add a question a prospective customer might ask ChatGPT to see if your brand comes up.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'ChatGPT', anthropic: 'Claude', perplexity: 'Perplexity', google_aio: 'Google AI Overviews',
}
function providerLabel(p: string) {
  return PROVIDER_LABELS[p] ?? p
}

function RunsCard({ clientId }: { clientId: string }) {
  const { data, isLoading } = useSWR(['visibility-runs', clientId], () => api.clients.visibilityRuns(clientId, 30))

  if (isLoading) return <Skeleton className="h-56 w-full" />

  const trend = (data?.trend ?? []).map(t => ({ date: t.date, mentionRate: Math.round(t.mentionRate * 100) }))
  const runs = data?.runs ?? []

  // Per-provider breakdown across the loaded window (handoff #3 §4a).
  const byProvider = new Map<string, { mentioned: number; total: number }>()
  for (const r of runs) {
    const b = byProvider.get(r.provider) ?? { mentioned: 0, total: 0 }
    b.total++
    if (r.mentioned) b.mentioned++
    byProvider.set(r.provider, b)
  }
  // Who's getting cited instead: top domains from runs where we were NOT
  // mentioned but the engine cited someone (Perplexity / AI Overviews).
  const citedInstead = new Map<string, number>()
  for (const r of runs) {
    if (r.mentioned || !r.citedDomains) continue
    for (const d of r.citedDomains) citedInstead.set(d, (citedInstead.get(d) ?? 0) + 1)
  }
  const topCited = [...citedInstead.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)

  return (
    <div className="grid gap-3">
      <Card>
        <CardHeader><CardTitle>Mention rate — last 30 days</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <TrendChart
            data={trend}
            dataKey="mentionRate"
            name="Mention rate"
            emptyLabel="No visibility checks run yet."
            valueFormatter={v => `${v}%`}
          />
        </CardContent>
      </Card>
      {byProvider.size > 0 && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[...byProvider.entries()].map(([prov, b]) => (
            <Card key={prov}>
              <CardContent className="p-3">
                <p className="text-xs text-muted-foreground">{providerLabel(prov)}</p>
                <p className="text-xl font-semibold">{Math.round((b.mentioned / b.total) * 100)}%</p>
                <p className="text-xs text-muted-foreground">{b.mentioned} of {b.total} checks</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      {topCited.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Who&apos;s getting cited instead</CardTitle></CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground">
              {topCited.map(([d, n]) => `${d} (${n})`).join(' · ')}
            </p>
          </CardContent>
        </Card>
      )}
      <Card className="overflow-hidden p-0">
        {runs.length ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Provider</TableHead>
                <TableHead>Mentioned</TableHead>
                <TableHead>Snippet</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.slice(0, 20).map(r => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{providerLabel(r.provider)}</TableCell>
                  <TableCell>
                    <Badge variant={r.mentioned ? 'success' : 'secondary'}>
                      <StatusDot variant={r.mentioned ? 'success' : 'secondary'} />
                      {r.mentioned ? 'Yes' : 'No'}
                    </Badge>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">{r.snippet || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState icon={Bot} title="No checks run yet" description="Add a query above and run a check to see if your brand shows up in AI search." />
        )}
      </Card>
    </div>
  )
}

export function AiVisibilityTab() {
  const { clientId } = useClientCtx()
  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm text-muted-foreground">Track how your brand shows up when people ask ChatGPT, Claude, Perplexity, and Google's AI Overviews.</p>
      </div>
      <QueriesCard clientId={clientId} />
      <RunsCard clientId={clientId} />
    </div>
  )
}
