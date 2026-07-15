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
import { CrawlResults } from '@/components/crawl-results'

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
  const [gscProperty, setGscProperty] = useState('')
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)

  function startEdit() {
    setPages((cfg?.seoPages ?? []).join('\n'))
    setTerms((cfg?.brandTerms ?? []).join(', '))
    setGscProperty(cfg?.gscProperty ?? '')
    setOpen(true)
  }

  async function save() {
    setSaving(true)
    try {
      await api.clients.updateSeoConfig(clientId, {
        seoPages: pages.split('\n').map(p => p.trim()).filter(Boolean),
        brandTerms: terms.split(',').map(t => t.trim()).filter(Boolean),
        gscProperty: gscProperty.trim() || undefined
      })
      mutate(['seo-config', clientId])
      mutate(['gsc-rankings', clientId])
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
            {cfg?.gscProperty ? ` · GSC: ${cfg.gscProperty}` : ' · No Search Console property connected'}
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
        <div className="grid gap-1.5">
          <Label>Search Console property (requires the platform service account added as a user on it)</Label>
          <Input value={gscProperty} onChange={e => setGscProperty(e.target.value)} placeholder="sc-domain:example.com or https://example.com/" />
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
  const key = ['gsc-rankings', clientId]
  const { data, isLoading } = useSWR(key, () => api.clients.seoRankings(clientId, 28))
  const [snapshotting, setSnapshotting] = useState(false)

  async function takeSnapshot() {
    setSnapshotting(true)
    try {
      await api.clients.snapshotRankings(clientId)
      mutate(key)
      toast.success('Snapshot saved — the trend chart will build up as you take more over time')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save snapshot')
    } finally {
      setSnapshotting(false)
    }
  }

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
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Clicks — last 28 days</CardTitle>
          <Button variant="secondary" size="sm" onClick={takeSnapshot} disabled={snapshotting}>
            <RefreshCw className={`h-3.5 w-3.5 ${snapshotting ? 'animate-spin' : ''}`} />
            {snapshotting ? 'Saving…' : 'Take snapshot'}
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          <TrendChart data={chartData} dataKey="clicks" name="Clicks" emptyLabel="No click data yet — click &ldquo;Take snapshot&rdquo; periodically to build up trend history." />
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

// Superadmin-only beta: full-site crawl audit via DataForSEO (costs real money
// per run), producing the SEMrush-style score + a prioritized issue tracker.
// Phase 0 of the SEO-automation plan — see docs/plans/seo-automation.md.
const TITLE_DESC_KEYS = ['no_title', 'title_too_short', 'title_too_long', 'irrelevant_title', 'no_description', 'duplicate_meta_tags', 'irrelevant_description']

function CrawlCard({ clientId }: { clientId: string }) {
  const { data: me } = useSWR('me', api.me)
  const isAdmin = !!me?.isSuperadmin
  const { data: crawl, mutate: mutateCrawl } = useSWR(['seo-crawl', clientId], () => api.clients.latestCrawl(clientId))
  const [running, setRunning] = useState(false)
  const [fixing, setFixing] = useState<null | 'meta' | 'schema' | 'llms'>(null)

  async function generateMetaFix() {
    if (!crawl) return
    setFixing('meta')
    try {
      const { count } = await api.clients.generateMetaFix(clientId, crawl.id)
      toast.success(`Drafted title & meta fixes for ${count} page(s) — see the Requests tab to review and approve.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate fix')
    } finally {
      setFixing(null)
    }
  }

  async function generateSchemaFix() {
    setFixing('schema')
    try {
      const { count } = await api.clients.generateSchemaFix(clientId)
      toast.success(`Drafted schema markup for ${count} page(s) — see the Requests tab to review and approve.`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate schema')
    } finally {
      setFixing(null)
    }
  }

  async function generateLlmsTxt() {
    setFixing('llms')
    try {
      await api.clients.generateLlmsTxt(clientId)
      toast.success('Drafted an llms.txt — see the Requests tab to review and approve.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate llms.txt')
    } finally {
      setFixing(null)
    }
  }

  const canFixMeta = isAdmin && crawl?.status === 'finished' && (crawl.checks ?? []).some(c => TITLE_DESC_KEYS.includes(c.key))
  const canFix = isAdmin && crawl?.status === 'finished'
  const canFixLlms = isAdmin && crawl?.status === 'finished' && crawl.aiSearch != null && !crawl.aiSearch.hasLlmsTxt

  async function run() {
    setRunning(true)
    try {
      let current = await api.clients.startCrawl(clientId)
      mutateCrawl(current, false)
      while (current.status === 'running') {
        await new Promise(r => setTimeout(r, 6000))
        current = await api.clients.refreshCrawl(clientId, current.id)
        mutateCrawl(current, false)
      }
      if (current.status === 'failed') toast.error(current.error ?? 'Crawl failed')
      else toast.success('Crawl audit complete')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Crawl failed')
    } finally {
      setRunning(false)
    }
  }

  const busy = running || crawl?.status === 'running'

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          Site Health Audit {isAdmin && <Badge variant="warning">beta</Badge>}
        </CardTitle>
        {isAdmin && (
          <Button size="sm" onClick={run} disabled={busy}>
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            {busy ? 'Crawling…' : 'Run crawl audit'}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        {!crawl && !busy && (
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? 'Crawl the whole site to generate an overall health score and a prioritized, plain-English list of what to fix. (Superadmin beta — each run costs a few cents.)'
              : 'Your first site health audit will appear here once your account manager runs it — an overall health score plus a prioritized, plain-English list of what to improve.'}
          </p>
        )}

        {crawl?.status === 'running' && (
          <p className="text-sm text-muted-foreground">Crawling the site — this usually takes about a minute…</p>
        )}
        {crawl?.status === 'failed' && (
          <p className="text-sm text-destructive">{crawl.error ?? 'Crawl failed'}</p>
        )}

        {crawl?.status === 'finished' && (
          <>
            <CrawlResults crawl={crawl} />
            {canFix && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-2.5">
                <span className="text-xs text-muted-foreground">Generate fixes:</span>
                {canFixMeta && (
                  <Button size="sm" variant="secondary" onClick={generateMetaFix} disabled={!!fixing}>
                    {fixing === 'meta' ? 'Drafting…' : 'Titles & meta descriptions'}
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={generateSchemaFix} disabled={!!fixing}>
                  {fixing === 'schema' ? 'Drafting…' : 'Schema markup'}
                </Button>
                {canFixLlms && (
                  <Button size="sm" variant="secondary" onClick={generateLlmsTxt} disabled={!!fixing}>
                    {fixing === 'llms' ? 'Drafting…' : 'llms.txt'}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function SiteHealthTab() {
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
        <p className="text-sm text-muted-foreground">Technical audits via Google PageSpeed Insights.</p>
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

      <CrawlCard clientId={clientId} />

      <ConfigCard clientId={clientId} />

      <div>
        <h2 className="mb-2 text-lg font-semibold">Rankings</h2>
        <p className="mb-3 text-sm text-muted-foreground">Keyword performance from Google Search Console.</p>
        <RankingsCard clientId={clientId} />
      </div>
    </div>
  )
}
