import { useState, useEffect, useRef, useCallback } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { Search, TrendingUp, Settings2, RefreshCw, Trash2, Lightbulb, Plus } from 'lucide-react'
import type { TargetKeyword, KeywordIdea } from '@/lib/api'
import { api } from '@/lib/api'
import { useClientCtx } from '@/pages/client/ClientLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Label } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'
import { AuditReport } from '@/components/audit-report'
import { AuditProgress } from '@/components/audit-progress'
import { useSetupTarget } from '@/lib/use-setup-target'
import { useSearchParams } from 'react-router-dom'

// A little chip that labels which feature on this page a setting drives, so it's
// obvious at a glance what each field actually affects.
function FeatureTag({ children }: { children: string }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  )
}

function Code({ children }: { children: string }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{children}</code>
}

// Lightweight modal (no dialog dep in this app): a fixed overlay + centered
// panel, Escape / click-outside to close, body-scroll locked while open. Fixed
// positioning means it renders correctly no matter where in the tree it lives,
// so the trigger can sit in the audit header.
function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="my-auto w-full max-w-lg rounded-lg border border-border bg-card shadow-xl" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

// The "Configure" trigger + its settings modal. Self-contained so it can be
// dropped into the audit header — the settings that drive the audit live right
// next to the Run audit button, not in a separate section down the page.
function ConfigButton({ clientId, domain }: { clientId: string; domain?: string }) {
  const { data: cfg } = useSWR(['seo-config', clientId], () => api.clients.seoConfig(clientId))
  const [open, setOpen] = useState(false)
  const [pages, setPages] = useState('')
  const [terms, setTerms] = useState('')
  const [gscProperty, setGscProperty] = useState('')
  const [saving, setSaving] = useState(false)
  const defaultTarget = (domain ?? '').replace(/^https?:\/\//, '').replace(/\/.*$/, '') || 'your domain'

  function startEdit() {
    setPages((cfg?.seoPages ?? []).join('\n'))
    setTerms((cfg?.brandTerms ?? []).join(', '))
    setGscProperty(cfg?.gscProperty ?? '')
    setOpen(true)
  }

  // Setup-checklist deep links for the fields edited here open the modal
  // directly — once per visit, after the config has loaded so the fields
  // prefill correctly.
  const [params] = useSearchParams()
  const setupKey = params.get('setup')
  const autoOpened = useRef(false)
  useEffect(() => {
    if ((setupKey === 'gscProperty' || setupKey === 'brandTerms') && cfg !== undefined && !autoOpened.current) {
      autoOpened.current = true
      startEdit()
    }
  }, [setupKey, cfg]) // eslint-disable-line react-hooks/exhaustive-deps

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

  return (
    <>
      <Button variant="outline" size="sm" onClick={startEdit}>
        <Settings2 className="h-3.5 w-3.5" /> Configure
      </Button>
      <Modal open={open} onClose={() => setOpen(false)}>
        <div className="border-b border-border p-4">
          <h2 className="flex items-center gap-2 font-semibold"><Settings2 className="h-4 w-4 text-primary" /> SEO settings</h2>
          <p className="mt-1 text-sm text-muted-foreground">Each field powers a different part of this page. Only the first one affects the <span className="font-medium text-foreground">SEO audit</span>.</p>
        </div>
        <div className="grid gap-5 p-4">
          <div className="grid gap-1.5">
            <div className="flex items-center gap-2">
              <Label>Audit start URL</Label>
              <FeatureTag>SEO audit</FeatureTag>
            </div>
            <Textarea value={pages} onChange={e => setPages(e.target.value)} rows={2} placeholder={`https://${defaultTarget === 'your domain' ? 'example.com' : defaultTarget}`} />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Your <span className="font-medium text-foreground">SEO audit</span> crawls the whole site from this URL, following internal links. Leave it blank to start from your domain (<span className="font-medium text-foreground">{defaultTarget}</span>). Any extra lines are used only to target schema-markup fixes.
            </p>
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center gap-2">
              <Label>Brand terms</Label>
              <FeatureTag>AI visibility</FeatureTag>
            </div>
            <Input value={terms} onChange={e => setTerms(e.target.value)} placeholder="Acme Co, Acme Plumbing" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Comma-separated names for the business. Used to detect when AI assistants mention this client in <span className="font-medium text-foreground">AI Search Visibility</span> — <span className="font-medium text-foreground">not</span> by the SEO audit.
            </p>
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center gap-2">
              <Label>Google Search Console property</Label>
              <FeatureTag>Rankings</FeatureTag>
            </div>
            <Input value={gscProperty} onChange={e => setGscProperty(e.target.value)} placeholder="sc-domain:example.com or https://example.com/" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Connects real keyword &amp; click data to the <span className="font-medium text-foreground">Rankings</span> section below. Format <Code>sc-domain:example.com</Code> or <Code>https://example.com/</Code>. Requires our service account added as a user on the property.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </Modal>
    </>
  )
}

// Improvement since the first recorded check. Lower position number is better,
// so a drop in the number is an improvement. null when there isn't enough
// history (or no movement) to say anything meaningful.
function positionDelta(kw: TargetKeyword): { improved: boolean; amount: number } | null {
  const points = kw.trend.filter(p => p.rank != null)
  if (points.length < 2) return null
  const first = points[0].rank as number
  const last = points[points.length - 1].rank as number
  if (first === last) return null
  return { improved: last < first, amount: Math.abs(first - last) }
}

function positionBadge(rank: number) {
  const variant = rank <= 3 ? 'success' : rank <= 10 ? 'warning' : 'secondary'
  return <Badge variant={variant}>#{rank}</Badge>
}

function difficultyBadge(d: number | null) {
  if (d == null) return <span className="text-xs text-muted-foreground">—</span>
  const variant = d <= 30 ? 'success' : d <= 60 ? 'warning' : 'destructive'
  return <Badge variant={variant}>{d}</Badge>
}

// "Winnable" = real demand + low competition. This is the whole point of the
// research step: surface the local long-tail you can actually rank for, instead
// of the fat-head terms that look great but are hopeless.
function isWinnable(i: KeywordIdea): boolean {
  return i.difficulty != null && i.difficulty <= 30 && (i.searchVolume ?? 0) >= 10
}

// Keyword research — the answer to "how do I even choose which keywords to
// track?". Expands a seed into long-tail ideas with search volume + difficulty,
// flags the winnable ones, and one-click adds them to the tracker above.
function KeywordResearchModal({ clientId, seedHint, tracked, open, onClose }: {
  clientId: string; seedHint: string; tracked: string[]; open: boolean; onClose: () => void
}) {
  const [seed, setSeed] = useState('')
  const [ideas, setIdeas] = useState<KeywordIdea[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [added, setAdded] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (open) { setSeed(seedHint); setIdeas(null); setAdded(new Set()) }
  }, [open, seedHint])

  async function search() {
    if (!seed.trim()) return
    setLoading(true)
    try {
      const res = await api.clients.keywordIdeas(clientId, seed.trim())
      // Winnable first, then by search volume — puts the good stuff on top.
      const sorted = [...res.ideas].sort((a, b) => {
        if (isWinnable(a) !== isWinnable(b)) return isWinnable(a) ? -1 : 1
        return (b.searchVolume ?? 0) - (a.searchVolume ?? 0)
      })
      setIdeas(sorted)
      if (sorted.length === 0) toast.info('No ideas found — try a broader or different seed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Research failed')
    } finally {
      setLoading(false)
    }
  }

  async function track(kw: string) {
    try {
      const res = await api.clients.addTargetKeyword(clientId, kw)
      mutate(['target-keywords', clientId], res, { revalidate: false })
      setAdded(prev => new Set(prev).add(kw.toLowerCase()))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to track')
    }
  }

  const trackedSet = new Set([...tracked.map(t => t.toLowerCase()), ...added])

  return (
    <Modal open={open} onClose={onClose}>
      <div className="border-b border-border p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Lightbulb className="h-4 w-4 text-primary" /> Find keywords</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Type a service or a service + city. We expand it into long-tail ideas with real search volume and difficulty — <span className="text-success">green difficulty</span> is winnable.
        </p>
      </div>
      <div className="p-4">
        <div className="flex gap-2">
          <Input
            value={seed}
            onChange={e => setSeed(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search() } }}
            placeholder="e.g. web design tampa"
          />
          <Button variant="secondary" size="sm" onClick={search} disabled={loading || !seed.trim()}>
            <Search className="h-3.5 w-3.5" /> {loading ? '…' : 'Search'}
          </Button>
        </div>

        {ideas && ideas.length > 0 && (
          <div className="mt-3 max-h-[50vh] overflow-y-auto rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Keyword</TableHead>
                  <TableHead title="Monthly searches">Volume</TableHead>
                  <TableHead title="0–100, lower is easier to rank">Difficulty</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {ideas.map(i => {
                  const isTracked = trackedSet.has(i.keyword.toLowerCase())
                  return (
                    <TableRow key={i.keyword} className={isWinnable(i) ? 'bg-success/5' : ''}>
                      <TableCell className="font-medium">{i.keyword}</TableCell>
                      <TableCell className="tabular-nums">{i.searchVolume?.toLocaleString() ?? '—'}</TableCell>
                      <TableCell>{difficultyBadge(i.difficulty)}</TableCell>
                      <TableCell>
                        {isTracked ? (
                          <span className="text-xs text-muted-foreground">Tracked</span>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => track(i.keyword)}>
                            <Plus className="h-3.5 w-3.5" /> Track
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      <div className="flex justify-end border-t border-border p-4">
        <Button size="sm" onClick={onClose}>Done</Button>
      </div>
    </Modal>
  )
}

// The strategic keyword tracker: the keywords a client WANTS to rank for, their
// current Google organic position, and movement over time. Distinct from the
// GSC card below, which shows what the site already ranks for. Positions come
// from DataForSEO on an explicit "Check rankings now" (spends credits, so it's
// never automatic and superadmin-only).
function TargetKeywordsCard({ clientId, isSuperadmin, seedHint }: { clientId: string; isSuperadmin: boolean; seedHint: string }) {
  const key = ['target-keywords', clientId]
  const { data, isLoading, mutate: mut } = useSWR(key, () => api.clients.targetKeywords(clientId))
  const [newKw, setNewKw] = useState('')
  const [adding, setAdding] = useState(false)
  const [checking, setChecking] = useState(false)
  const [researchOpen, setResearchOpen] = useState(false)

  async function add() {
    if (!newKw.trim()) return
    setAdding(true)
    try {
      const res = await api.clients.addTargetKeyword(clientId, newKw.trim())
      setNewKw('')
      mut(res, { revalidate: false })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add keyword')
    } finally {
      setAdding(false)
    }
  }

  async function remove(id: string) {
    try {
      const res = await api.clients.removeTargetKeyword(clientId, id)
      mut(res, { revalidate: false })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove')
    }
  }

  async function check() {
    setChecking(true)
    try {
      const res = await api.clients.checkTargetKeywords(clientId)
      mut(res, { revalidate: false })
      toast.success('Rankings updated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to check rankings')
    } finally {
      setChecking(false)
    }
  }

  const target = useSetupTarget('targetKeywords')

  if (isLoading) return <Skeleton className="h-56 w-full" />
  const keywords = data?.keywords ?? []

  return (
    <Card ref={target.ref} className={`overflow-hidden p-0 ${target.highlight}`}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 p-4">
        <CardTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Target keywords</CardTitle>
        {isSuperadmin && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setResearchOpen(true)}>
              <Lightbulb className="h-3.5 w-3.5" /> Find keywords
            </Button>
            {keywords.length > 0 && (
              <Button variant="secondary" size="sm" onClick={check} disabled={checking}>
                <RefreshCw className={`h-3.5 w-3.5 ${checking ? 'animate-spin' : ''}`} /> {checking ? 'Checking…' : 'Check rankings now'}
              </Button>
            )}
          </div>
        )}
      </CardHeader>

      {isSuperadmin && (
        <div className="flex items-end gap-2 border-b border-border px-4 pb-3">
          <div className="grid flex-1 gap-1.5">
            <Label>Add a keyword to track</Label>
            <Input
              value={newKw}
              onChange={e => setNewKw(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') add() }}
              placeholder="e.g. tampa web design"
            />
          </div>
          <Button size="sm" onClick={add} disabled={adding || !newKw.trim()}>{adding ? 'Adding…' : 'Add'}</Button>
        </div>
      )}

      {keywords.length ? (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Keyword</TableHead>
              <TableHead>Position</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>Last checked</TableHead>
              {isSuperadmin && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {keywords.map(kw => {
              const delta = positionDelta(kw)
              return (
                <TableRow key={kw.id}>
                  <TableCell className="font-medium">{kw.keyword}</TableCell>
                  <TableCell>
                    {kw.latestCheckedAt == null
                      ? <span className="text-xs text-muted-foreground">Not checked yet</span>
                      : kw.latestRank == null
                        ? <Badge variant="secondary">Not in top 100</Badge>
                        : positionBadge(kw.latestRank)}
                  </TableCell>
                  <TableCell>
                    {delta == null
                      ? <span className="text-xs text-muted-foreground">—</span>
                      : <span className={delta.improved ? 'text-success' : 'text-destructive'}>
                          {delta.improved ? '▲' : '▼'} {delta.amount}
                        </span>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {kw.latestCheckedAt ? new Date(kw.latestCheckedAt).toLocaleDateString() : '—'}
                  </TableCell>
                  {isSuperadmin && (
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => remove(kw.id)} title="Stop tracking">
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      ) : (
        <EmptyState
          icon={TrendingUp}
          title="No target keywords yet"
          description={isSuperadmin ? 'Not sure which keywords to track? Click "Find keywords" to get winnable local suggestions with search volume and difficulty.' : 'Your target keywords and their Google positions will appear here.'}
        />
      )}
      <KeywordResearchModal
        clientId={clientId}
        seedHint={seedHint}
        tracked={keywords.map(k => k.keyword)}
        open={researchOpen}
        onClose={() => setResearchOpen(false)}
      />
    </Card>
  )
}

// What the site ALREADY ranks for, straight from Google Search Console. Only
// shows when GSC is connected for this client.
function GscQueriesCard({ clientId }: { clientId: string }) {
  const { data, isLoading } = useSWR(['gsc-rankings', clientId], () => api.clients.seoRankings(clientId, 28))

  if (isLoading) return <Skeleton className="h-40 w-full" />

  if (!data?.connected) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={Search}
            title="Google Search Console not connected"
            description="Ask your account manager to connect Search Console in SEO settings to also see the exact queries your site already appears for."
          />
        </CardContent>
      </Card>
    )
  }

  const topQueries = (data.latest?.rows ?? []).slice(0, 10)
  return (
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
  )
}

// The client's SEO audit — a full-site crawl via DataForSEO (costs real money
// per run), producing an on-page health score + a prioritized issue tracker,
// rendered with the same AuditReport as the standalone Audit Tool. This is the
// single audit on the page; there is no separate PageSpeed audit anymore.
// Superadmin runs it; the finalizer in the API completes it even if this tab
// closes. Phase 0 of the SEO-automation plan — see docs/plans/seo-automation.md.
const TITLE_DESC_KEYS = ['no_title', 'title_too_short', 'title_too_long', 'irrelevant_title', 'no_description', 'duplicate_meta_tags', 'irrelevant_description']

function AuditCard({ clientId, domain }: { clientId: string; domain?: string }) {
  const { data: me } = useSWR('me', api.me)
  const isAdmin = !!me?.isSuperadmin
  const { data: crawl, mutate: mutateCrawl } = useSWR(['seo-crawl', clientId], () => api.clients.latestCrawl(clientId))
  const { data: history, mutate: mutateHistory } = useSWR(['seo-crawl-history', clientId], () => api.clients.crawlHistory(clientId))
  const [starting, setStarting] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [fixing, setFixing] = useState<null | 'meta' | 'schema' | 'llms'>(null)
  // Guards the poll loop so a remount or re-render can't spin up a second one.
  const pollingRef = useRef(false)

  // Poll a running crawl to completion. Each refreshCrawl call is what actually
  // advances the crawl on the backend (finalizes it, or trips the 10-min
  // timeout) — there is no server-side scheduler — so this MUST keep running
  // until the crawl leaves 'running'.
  const pollUntilDone = useCallback(async (crawlId: string) => {
    if (pollingRef.current) return
    pollingRef.current = true
    try {
      let current = await api.clients.refreshCrawl(clientId, crawlId)
      mutateCrawl(current, false)
      while (current.status === 'running') {
        await new Promise(r => setTimeout(r, 6000))
        current = await api.clients.refreshCrawl(clientId, current.id)
        mutateCrawl(current, false)
      }
      // Suppress the failure toast for user-initiated cancels — cancel() already
      // shows its own confirmation.
      if (current.status === 'failed' && current.error !== 'Canceled') toast.error(current.error ?? 'Crawl failed')
      else if (current.status === 'finished') {
        toast.success('Crawl audit complete')
        // The finished crawl is a new point on the trend; without this the
        // Progress panel keeps comparing against the run before this one.
        void mutateHistory()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Crawl failed')
    } finally {
      pollingRef.current = false
    }
  }, [clientId, mutateCrawl, mutateHistory])

  // Resume polling a crawl that's still 'running' when the card mounts — e.g.
  // the operator started a crawl, navigated away (killing the previous poll
  // loop), and came back to a row that would otherwise sit stuck on "Crawling…"
  // forever with the button disabled. This is also the single polling entry
  // point for freshly-started crawls (run() just flips the row to 'running').
  useEffect(() => {
    if (isAdmin && crawl?.status === 'running' && crawl.id && !pollingRef.current) {
      void pollUntilDone(crawl.id)
    }
  }, [isAdmin, crawl?.status, crawl?.id, pollUntilDone])

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
    setStarting(true)
    try {
      // Just kick the crawl off; the useEffect above picks up the 'running'
      // status and drives the poll loop to completion.
      const started = await api.clients.startCrawl(clientId)
      mutateCrawl(started, false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Crawl failed')
    } finally {
      setStarting(false)
    }
  }

  async function cancel() {
    if (!crawl) return
    setCanceling(true)
    try {
      const canceled = await api.clients.cancelCrawl(clientId, crawl.id)
      mutateCrawl(canceled, false)
      toast.success('Crawl canceled — you can start a fresh one now')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel crawl')
    } finally {
      setCanceling(false)
    }
  }

  const busy = starting || crawl?.status === 'running'

  // gscProperty + brandTerms live in this card's Configure modal, so all
  // three checklist deep links highlight here (the modal auto-opens for the
  // config ones — see ConfigButton).
  const target = useSetupTarget('baselineCrawl', 'gscProperty', 'brandTerms')

  return (
    <Card ref={target.ref} className={target.highlight}>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          SEO Audit {isAdmin && <Badge variant="warning">beta</Badge>}
        </CardTitle>
        <div className="flex items-center gap-2">
          <ConfigButton clientId={clientId} domain={domain} />
          {isAdmin && busy && (
            <Button variant="ghost" size="sm" onClick={cancel} disabled={canceling}>
              {canceling ? 'Canceling…' : 'Cancel'}
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" onClick={run} disabled={busy}>
              <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
              {busy ? 'Auditing…' : 'Run audit'}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        {!crawl && !busy && (
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? 'Run a full-site audit to generate an overall health score and a prioritized, plain-English list of what to fix. (Superadmin beta — each run costs a few cents.)'
              : 'Your first SEO audit will appear here once your account manager runs it — an overall health score plus a prioritized, plain-English list of what to improve.'}
          </p>
        )}

        {busy && (
          <p className="text-sm text-muted-foreground">
            {crawl?.pagesCrawled != null && crawl.pagesCrawled > 0
              ? `Crawling the site — ${crawl.pagesCrawled} page${crawl.pagesCrawled === 1 ? '' : 's'} scanned so far…`
              : 'Starting the crawl — this can take a few minutes on a larger site…'}
          </p>
        )}
        {crawl?.status === 'failed' && (
          <p className="text-sm text-destructive">{crawl.error ?? 'Crawl failed'}</p>
        )}

        {crawl?.status === 'finished' && (
          <>
            <AuditReport crawl={crawl} showCost={isAdmin} />
            <p className="text-xs text-muted-foreground">
              Last audited: {new Date(crawl.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
            <AuditProgress points={history ?? []} />
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
  const { clientId, client } = useClientCtx()
  const { data: me } = useSWR('me', api.me)
  const isSuperadmin = me?.isSuperadmin ?? false

  return (
    <div className="flex flex-col gap-6">
      <AuditCard clientId={clientId} domain={client?.domain} />

      <div>
        <h2 className="mb-1 text-lg font-semibold">Rankings</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          The keywords you&apos;re working to rank for and where you sit on Google today.
        </p>
        <TargetKeywordsCard clientId={clientId} isSuperadmin={isSuperadmin} seedHint={client?.industry ?? client?.name ?? ''} />
      </div>

      <div>
        <h2 className="mb-1 text-lg font-semibold">Already ranking for</h2>
        <p className="mb-3 text-sm text-muted-foreground">
          Queries your site already appears for, from Google Search Console.
        </p>
        <GscQueriesCard clientId={clientId} />
      </div>
    </div>
  )
}
