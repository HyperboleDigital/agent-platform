import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { Search, TrendingUp, Settings2, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import type { SeoAudit } from '@/lib/api'
import { useClientCtx } from '@/pages/client/ClientLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Label } from '@/components/ui/input'
import { Badge, StatusDot } from '@/components/ui/badge'
import { StatTile } from '@/components/stat-tile'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'
import { TrendChart } from '@/components/charts/trend-chart'

function scoreVariant(score: number): 'success' | 'warning' | 'destructive' {
  if (score >= 90) return 'success'
  if (score >= 50) return 'warning'
  return 'destructive'
}

function AuditCard({ latest, prev }: { latest: SeoAudit; prev?: SeoAudit }) {
  const rows: Array<[string, keyof SeoAudit['scores']]> = [
    ['Performance', 'performance'], ['SEO', 'seo'], ['Accessibility', 'accessibility'], ['Best practices', 'bestPractices']
  ]
  return (
    <Card>
      <CardHeader>
        <CardTitle>Latest audit — {latest.url}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {rows.map(([label, key]) => {
            const score = latest.scores[key]
            const delta = prev ? score - prev.scores[key] : null
            return (
              <StatTile
                key={key}
                label={label}
                value={
                  <span className="flex items-baseline gap-1.5">
                    <Badge variant={scoreVariant(score)}><StatusDot variant={scoreVariant(score)} />{score}</Badge>
                    {delta !== null && delta !== 0 && (
                      <span className={delta > 0 ? 'text-xs text-success' : 'text-xs text-destructive'}>
                        {delta > 0 ? '+' : ''}{delta}
                      </span>
                    )}
                  </span>
                }
              />
            )
          })}
        </div>
        {latest.recommendations && (
          <div className="rounded-md border border-border bg-muted/30 p-4 text-sm leading-relaxed whitespace-pre-line">
            {latest.recommendations}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ConfigCard({ clientId }: { clientId: string }) {
  const { data: cfg } = useSWR(['seo-config', clientId], () => api.clients.seoConfig(clientId))
  const [pages, setPages] = useState('')
  const [terms, setTerms] = useState('')
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)

  function startEdit() {
    setPages((cfg?.seoPages ?? []).join('\n'))
    setTerms((cfg?.brandTerms ?? []).join(', '))
    setOpen(true)
  }

  async function save() {
    setSaving(true)
    try {
      await api.clients.updateSeoConfig(clientId, {
        seoPages: pages.split('\n').map(p => p.trim()).filter(Boolean),
        brandTerms: terms.split(',').map(t => t.trim()).filter(Boolean)
      })
      mutate(['seo-config', clientId])
      setOpen(false)
      toast.success('SEO settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-4 pt-5">
          <div className="text-sm text-muted-foreground">
            {cfg?.seoPages?.length ? `${cfg.seoPages.length} page(s) tracked` : 'No pages configured yet — using the client domain by default.'}
          </div>
          <Button variant="secondary" size="sm" onClick={startEdit}>
            <Settings2 className="h-3.5 w-3.5" /> Configure
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="grid gap-3 pt-5">
        <div className="grid gap-1.5">
          <Label>Pages to audit (one URL per line)</Label>
          <Textarea value={pages} onChange={e => setPages(e.target.value)} rows={3} placeholder="https://example.com" />
        </div>
        <div className="grid gap-1.5">
          <Label>Brand terms (comma-separated, used for AI visibility matching)</Label>
          <Input value={terms} onChange={e => setTerms(e.target.value)} placeholder="Acme Co, Acme Plumbing" />
        </div>
        <div className="flex gap-2">
          <Button onClick={save} disabled={saving} size="sm">{saving ? 'Saving…' : 'Save'}</Button>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  )
}

function RankingsCard({ clientId }: { clientId: string }) {
  const { data, isLoading } = useSWR(['gsc-rankings', clientId], () => api.clients.seoRankings(clientId, 28))

  if (isLoading) return <Skeleton className="h-56 w-full" />

  if (!data?.connected) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={TrendingUp}
            title="Google Search Console not connected"
            description="Ask your account manager to add the Search Console service account to your property, then set it in SEO settings — real keyword rankings and click data will show up here."
          />
        </CardContent>
      </Card>
    )
  }

  const chartData = data.trend.map(s => ({ date: s.date, clicks: s.totals.clicks }))
  const topQueries = (data.latest?.rows ?? []).slice(0, 10)

  return (
    <div className="grid gap-3">
      <Card>
        <CardHeader><CardTitle>Clicks — last 28 days</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <TrendChart data={chartData} dataKey="clicks" name="Clicks" emptyLabel="No click data yet." />
        </CardContent>
      </Card>
      <Card className="overflow-hidden p-0">
        {topQueries.length ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Query</TableHead>
                <TableHead>Clicks</TableHead>
                <TableHead>Impressions</TableHead>
                <TableHead>Avg. position</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topQueries.map(q => (
                <TableRow key={q.query}>
                  <TableCell className="font-medium">{q.query}</TableCell>
                  <TableCell>{q.clicks}</TableCell>
                  <TableCell className="text-muted-foreground">{q.impressions}</TableCell>
                  <TableCell className="text-muted-foreground">{q.position.toFixed(1)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState icon={Search} title="No query data yet" description="Search Console data appears here once Google has indexed traffic." />
        )}
      </Card>
    </div>
  )
}

export default function Seo() {
  const { clientId } = useClientCtx()
  const { data: audits, isLoading } = useSWR(['seo-audits', clientId], () => api.clients.seoAudits(clientId))
  const [running, setRunning] = useState(false)

  async function runAudit() {
    setRunning(true)
    try {
      await api.clients.runSeoAudit(clientId)
      mutate(['seo-audits', clientId])
      toast.success('Audit complete')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to run audit')
    } finally {
      setRunning(false)
    }
  }

  const [latest, prev] = audits ?? []

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Site health</h2>
          <p className="text-sm text-muted-foreground">Technical audits via Google PageSpeed Insights.</p>
        </div>
        <Button onClick={runAudit} disabled={running} size="sm">
          <RefreshCw className={`h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`} />
          {running ? 'Running…' : 'Run audit'}
        </Button>
      </div>

      {isLoading && <Skeleton className="h-40 w-full" />}
      {!isLoading && !latest && (
        <Card>
          <CardContent>
            <EmptyState icon={Search} title="No audits yet" description="Run your first audit to see performance, SEO, and accessibility scores." />
          </CardContent>
        </Card>
      )}
      {latest && <AuditCard latest={latest} prev={prev} />}

      <ConfigCard clientId={clientId} />

      <div>
        <h2 className="mb-2 text-lg font-semibold">Rankings</h2>
        <p className="mb-3 text-sm text-muted-foreground">Keyword performance from Google Search Console.</p>
        <RankingsCard clientId={clientId} />
      </div>
    </div>
  )
}
