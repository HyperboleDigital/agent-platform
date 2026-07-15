import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { Bot, Plus, X, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
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
  const [newQuery, setNewQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [runningAll, setRunningAll] = useState(false)

  async function add() {
    if (!newQuery.trim()) return
    setAdding(true)
    try {
      await api.clients.addVisibilityQuery(clientId, newQuery.trim())
      setNewQuery('')
      mutate(key)
      toast.success('Query added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add query')
    } finally {
      setAdding(false)
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
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Tracked queries</CardTitle>
        <Button size="sm" onClick={runAll} disabled={runningAll || !queries?.length}>
          <RefreshCw className={`h-3.5 w-3.5 ${runningAll ? 'animate-spin' : ''}`} />
          {runningAll ? 'Checking…' : 'Run all'}
        </Button>
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

function providerLabel(p: string) {
  return p === 'openai' ? 'ChatGPT' : 'Claude'
}

function RunsCard({ clientId }: { clientId: string }) {
  const { data, isLoading } = useSWR(['visibility-runs', clientId], () => api.clients.visibilityRuns(clientId, 30))

  if (isLoading) return <Skeleton className="h-56 w-full" />

  const trend = (data?.trend ?? []).map(t => ({ date: t.date, mentionRate: Math.round(t.mentionRate * 100) }))
  const runs = data?.runs ?? []

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
        <p className="text-sm text-muted-foreground">Track how your brand shows up when people ask ChatGPT and Claude.</p>
      </div>
      <QueriesCard clientId={clientId} />
      <RunsCard clientId={clientId} />
    </div>
  )
}
