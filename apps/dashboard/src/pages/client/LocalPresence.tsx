import { useState, useEffect, Fragment } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { MapPin, Plus, Trash2, AlertTriangle, Star, Settings2, Search } from 'lucide-react'
import { api } from '@/lib/api'
import type { Citation, CitationStatus, GbpKind, PlaceCandidate } from '@/lib/api'
import { useClientCtx } from '@/pages/client/ClientLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Label } from '@/components/ui/input'
import { Badge, StatusDot } from '@/components/ui/badge'
import { StatTile } from '@/components/stat-tile'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'
import { useConfirm } from '@/components/confirm-dialog'

const STATUS_LABEL: Record<CitationStatus, string> = {
  pending: 'Pending',
  live: 'Live',
  inconsistent: 'Inconsistent',
  not_applicable: 'N/A'
}

const KIND_LABEL: Record<GbpKind, string> = {
  post: 'Post',
  photo: 'Photo',
  qa: 'Q&A',
  category: 'Category',
  other: 'Other'
}

function statusVariant(c: Citation): 'success' | 'warning' | 'destructive' | 'secondary' {
  // A NAP mismatch outranks the hand-set status — drift is the thing worth
  // surfacing even on a listing someone already marked "live".
  if (c.napMatches === false) return 'destructive'
  if (c.status === 'live') return 'success'
  if (c.status === 'inconsistent') return 'destructive'
  if (c.status === 'not_applicable') return 'secondary'
  return 'warning'
}

function CitationsCard({ clientId, isSuperadmin }: { clientId: string; isSuperadmin: boolean }) {
  const key = ['citations', clientId]
  const { data, isLoading, mutate } = useSWR(key, () => api.clients.citations(clientId))
  const [busy, setBusy] = useState(false)
  const confirm = useConfirm()

  async function seed() {
    setBusy(true)
    try {
      const { added } = await api.clients.seedCitations(clientId)
      await mutate()
      toast.success(added > 0 ? `Added ${added} directories` : 'All standard directories already tracked')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to seed directories')
    } finally {
      setBusy(false)
    }
  }

  async function setStatus(c: Citation, status: CitationStatus) {
    try {
      await api.clients.saveCitation(clientId, { directory: c.directory, status })
      await mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update listing')
    }
  }

  async function remove(c: Citation) {
    if (!(await confirm(`Stop tracking ${c.directory}?`))) return
    try {
      await api.clients.deleteCitation(clientId, c.id)
      await mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove listing')
    }
  }

  if (isLoading) return <Skeleton className="h-64 w-full" />

  const citations = data?.citations ?? []
  const summary = data?.summary

  return (
    <div className="flex flex-col gap-3">
      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Directories tracked" value={summary.total} />
          <StatTile label="Live" value={summary.live} />
          <StatTile label="Pending" value={summary.pending} />
          <StatTile
            label="Inconsistent"
            value={
              summary.inconsistent > 0
                ? <span className="text-destructive">{summary.inconsistent}</span>
                : summary.inconsistent
            }
          />
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 p-4">
          <CardTitle className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /> Directory citations</CardTitle>
          {isSuperadmin && (
            <Button variant="outline" size="sm" onClick={seed} disabled={busy}>
              <Plus className="h-3.5 w-3.5" /> {busy ? 'Adding…' : 'Add standard directories'}
            </Button>
          )}
        </CardHeader>
        {citations.length ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Directory</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>NAP</TableHead>
                {isSuperadmin && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {citations.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    {c.listingUrl ? (
                      <a href={c.listingUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {c.directory}
                      </a>
                    ) : c.directory}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(c)}>
                      <StatusDot variant={statusVariant(c)} />
                      {STATUS_LABEL[c.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.napMatches === false ? (
                      <span className="flex items-center gap-1 text-destructive">
                        <AlertTriangle className="h-3.5 w-3.5" /> Doesn't match
                      </span>
                    ) : c.napMatches === true ? (
                      <span className="text-success">Matches</span>
                    ) : (
                      <span className="text-xs">Not recorded</span>
                    )}
                  </TableCell>
                  {isSuperadmin && (
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <select
                          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                          value={c.status}
                          onChange={e => setStatus(c, e.target.value as CitationStatus)}
                        >
                          {(Object.keys(STATUS_LABEL) as CitationStatus[]).map(s => (
                            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                          ))}
                        </select>
                        <Button variant="ghost" size="sm" onClick={() => remove(c)} title="Stop tracking">
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState
            icon={MapPin}
            title="No directories tracked yet"
            description={isSuperadmin ? 'Click "Add standard directories" to start the checklist.' : 'Directory listings will appear here as they go live.'}
          />
        )}
      </Card>
    </div>
  )
}

// Prompts superadmin to open the Local Presence Configure modal (its own place,
// no longer buried in SEO settings).
function SetupPrompt({ isSuperadmin, what, onConfigure }: { isSuperadmin: boolean; what: string; onConfigure: () => void }) {
  return (
    <EmptyState
      icon={Settings2}
      title={`${what} isn't set up yet`}
      description={isSuperadmin ? undefined : 'Ask your account manager to connect this.'}
      action={isSuperadmin ? (
        <Button variant="outline" size="sm" onClick={onConfigure}>
          <Settings2 className="h-3.5 w-3.5" /> Configure
        </Button>
      ) : undefined}
    />
  )
}

function ReviewsCard({ clientId, isSuperadmin, placeId, onConfigure }: { clientId: string; isSuperadmin: boolean; placeId?: string; onConfigure: () => void }) {
  const key = ['gbp-reviews', clientId]
  const { data, error, isLoading } = useSWR(key, () => api.clients.gbpReviews(clientId), { shouldRetryOnError: false })

  if (!placeId) {
    return (
      <Card>
        <CardHeader><CardTitle>Reviews</CardTitle></CardHeader>
        <CardContent className="pt-0"><SetupPrompt isSuperadmin={isSuperadmin} what="Review tracking" onConfigure={onConfigure} /></CardContent>
      </Card>
    )
  }

  if (isLoading) return <Skeleton className="h-64 w-full" />

  if (error || !data) {
    return (
      <Card>
        <CardHeader><CardTitle>Reviews</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <EmptyState icon={AlertTriangle} title="Couldn't load reviews" description={error instanceof Error ? error.message : 'Try again shortly.'} />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2"><Star className="h-4 w-4 text-primary" /> Reviews</CardTitle>
        {data.mapsUrl && (
          <a href={data.mapsUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-muted-foreground hover:underline">
            View on Google Maps
          </a>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-2">
          <StatTile
            label="Rating"
            value={data.rating != null ? `${data.rating.toFixed(1)} ★` : '—'}
          />
          <StatTile label="Total reviews" value={data.reviewCount} />
        </div>
        {data.reviews.length ? (
          <div className="flex flex-col gap-2">
            {data.reviews.map((r, i) => (
              <div key={i} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{r.authorName}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {r.rating} <Star className="h-3 w-3 fill-current" /> · {r.relativeTime}
                  </span>
                </div>
                {r.text && <p className="mt-1 text-sm text-muted-foreground">{r.text}</p>}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No recent reviews with text.</p>
        )}
        <p className="text-xs text-muted-foreground">Auto-pulled from Google · last updated {new Date(data.fetchedAt).toLocaleString()}</p>
      </CardContent>
    </Card>
  )
}

function MapRankCard({ clientId, isSuperadmin, hasKeywords, onConfigure }: { clientId: string; isSuperadmin: boolean; hasKeywords: boolean; onConfigure: () => void }) {
  const key = ['map-rank', clientId]
  const { data, error, isLoading } = useSWR(key, () => api.clients.mapRank(clientId), { shouldRetryOnError: false })

  if (!hasKeywords) {
    return (
      <Card>
        <CardHeader><CardTitle>Map pack ranking</CardTitle></CardHeader>
        <CardContent className="pt-0"><SetupPrompt isSuperadmin={isSuperadmin} what="Map-pack rank tracking" onConfigure={onConfigure} /></CardContent>
      </Card>
    )
  }

  if (isLoading) return <Skeleton className="h-48 w-full" />

  if (error || !data) {
    return (
      <Card>
        <CardHeader><CardTitle>Map pack ranking</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <EmptyState icon={AlertTriangle} title="Couldn't check rank" description={error instanceof Error ? error.message : 'Try again shortly.'} />
        </CardContent>
      </Card>
    )
  }

  // Group by location so it's clear which city each ranking is for — a client
  // is often tracked across several. Preserves the order locations came back in.
  const byLocation = new Map<string, typeof data.results>()
  for (const r of data.results) {
    const arr = byLocation.get(r.location) ?? []
    arr.push(r)
    byLocation.set(r.location, arr)
  }
  // "Tampa,Florida,United States" → "Tampa, Florida" for a friendlier header.
  const prettyLocation = (loc: string) => loc.split(',').slice(0, 2).join(', ')

  return (
    <Card className="overflow-hidden p-0">
      <CardHeader className="p-4">
        <CardTitle className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /> Map pack ranking</CardTitle>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Keyword</TableHead>
            <TableHead>Position</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from(byLocation.entries()).map(([location, rows]) => (
            <Fragment key={location}>
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={2} className="bg-muted/40 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {prettyLocation(location)}</span>
                </TableCell>
              </TableRow>
              {rows.map(r => (
                <TableRow key={`${location}::${r.keyword}`}>
                  <TableCell className="font-medium">{r.keyword}</TableCell>
                  <TableCell>
                    {r.rankAbsolute != null ? (
                      <Badge variant={r.rankAbsolute <= 3 ? 'success' : r.rankAbsolute <= 10 ? 'warning' : 'secondary'}>
                        #{r.rankAbsolute}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Not in top 20</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}

function GbpCard({ clientId, isSuperadmin }: { clientId: string; isSuperadmin: boolean }) {
  const key = ['gbp', clientId]
  const { data, isLoading, mutate } = useSWR(key, () => api.clients.gbpActivity(clientId))
  const [kind, setKind] = useState<GbpKind>('post')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)

  async function add() {
    if (!title.trim()) return
    setSaving(true)
    try {
      await api.clients.addGbpActivity(clientId, { kind, title: title.trim(), url: url.trim() || undefined })
      setTitle('')
      setUrl('')
      await mutate()
      toast.success('Activity logged')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to log activity')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    try {
      await api.clients.deleteGbpActivity(clientId, id)
      await mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  if (isLoading) return <Skeleton className="h-64 w-full" />

  const activity = data?.activity ?? []

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>Google Business Profile</CardTitle>
        <Badge variant={(data?.postsThisMonth ?? 0) >= 4 ? 'success' : 'warning'}>
          <StatusDot variant={(data?.postsThisMonth ?? 0) >= 4 ? 'success' : 'warning'} />
          {data?.postsThisMonth ?? 0} posts in the last 30 days
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        {isSuperadmin && (
          <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
            <div className="grid gap-1.5">
              <Label>Type</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={kind}
                onChange={e => setKind(e.target.value as GbpKind)}
              >
                {(Object.keys(KIND_LABEL) as GbpKind[]).map(k => (
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>
                ))}
              </select>
            </div>
            <div className="grid flex-1 gap-1.5">
              <Label>What was done</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Spring maintenance offer post" />
            </div>
            <div className="grid gap-1.5">
              <Label>Link (optional)</Label>
              <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" />
            </div>
            <Button size="sm" onClick={add} disabled={saving || !title.trim()}>
              {saving ? 'Saving…' : 'Log'}
            </Button>
          </div>
        )}

        {activity.length ? (
          <div className="flex flex-col gap-1.5">
            {activity.map(a => (
              <div key={a.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Badge variant="secondary">{KIND_LABEL[a.kind]}</Badge>
                  <span className="truncate text-sm">
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="hover:underline">{a.title}</a>
                    ) : a.title}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground">{new Date(a.performedAt).toLocaleDateString()}</span>
                  {isSuperadmin && (
                    <Button variant="ghost" size="sm" onClick={() => remove(a.id)} title="Delete">
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon={MapPin} title="No activity logged yet" description="Posts, photos, and Q&A updates appear here." />
        )}
      </CardContent>
    </Card>
  )
}

// Minimal modal (no dialog dep in this app): fixed overlay + centered panel,
// Escape / click-outside to close, body-scroll locked while open.
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

// Local Presence configuration — its own thing, on its own page, no longer
// folded into SEO settings. Resolves the Place ID by business-name search so
// nobody has to hunt for a cryptic ChIJ… string.
function LocalConfigModal({ clientId, open, onClose }: { clientId: string; open: boolean; onClose: () => void }) {
  const { data: cfg } = useSWR(open ? ['local-config', clientId] : null, () => api.clients.localConfig(clientId))
  const [placeId, setPlaceId] = useState('')
  const [placeLabel, setPlaceLabel] = useState('')
  const [keywords, setKeywords] = useState('')
  const [locationsText, setLocationsText] = useState('')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([])
  // Escape hatch for listings not yet in the Places index (e.g. brand-new
  // Business Profiles, which take days–weeks to propagate): paste the ID.
  const [manual, setManual] = useState(false)

  // Seed local state once config arrives; reset the seed flag whenever the
  // modal closes so it re-seeds fresh next open.
  if (cfg && !loaded) {
    setPlaceId(cfg.placeId)
    setKeywords(cfg.localKeywords.join(', '))
    setLocationsText(cfg.localLocations.join('\n'))
    setLoaded(true)
  }
  useEffect(() => { if (!open) { setLoaded(false); setCandidates([]); setQ(''); setManual(false) } }, [open])

  async function runSearch() {
    if (!q.trim()) return
    setSearching(true)
    try {
      const { candidates } = await api.clients.placeSearch(clientId, q.trim())
      setCandidates(candidates)
      if (candidates.length === 0) toast.info('No businesses found — try adding the city')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  function pick(c: PlaceCandidate) {
    setPlaceId(c.placeId)
    setPlaceLabel(`${c.name}${c.address ? ` — ${c.address}` : ''}`)
    setCandidates([])
    setQ('')
  }

  async function save() {
    setSaving(true)
    try {
      await api.clients.updateLocalConfig(clientId, {
        placeId: placeId.trim(),
        localKeywords: keywords.split(',').map(k => k.trim()).filter(Boolean),
        localLocations: locationsText.split('\n').map(l => l.trim()).filter(Boolean)
      })
      mutate(['client', clientId])
      mutate(['gbp-reviews', clientId])
      mutate(['map-rank', clientId])
      onClose()
      toast.success('Local presence settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="border-b border-border p-4">
        <h2 className="flex items-center gap-2 font-semibold"><Settings2 className="h-4 w-4 text-primary" /> Local presence settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">Connect the Google Business Profile and set the keywords to track locally.</p>
      </div>
      <div className="grid gap-5 p-4">
        <div className="grid gap-1.5">
          <Label>Google Business Profile</Label>
          {placeId ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
              <span className="truncate">{placeLabel || placeId}</span>
              <Button variant="ghost" size="sm" onClick={() => { setPlaceId(''); setPlaceLabel('') }}>Change</Button>
            </div>
          ) : manual ? (
            <>
              <Input value={placeId} onChange={e => setPlaceId(e.target.value)} placeholder="ChIJ..." />
              <button type="button" onClick={() => setManual(false)} className="self-start text-xs text-primary hover:underline">
                ← Back to search
              </button>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <Input
                  value={q}
                  onChange={e => setQ(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runSearch() } }}
                  placeholder="Search your business name + city"
                />
                <Button variant="secondary" size="sm" onClick={runSearch} disabled={searching || !q.trim()}>
                  <Search className="h-3.5 w-3.5" /> {searching ? '…' : 'Search'}
                </Button>
              </div>
              {candidates.length > 0 && (
                <div className="mt-1 flex flex-col gap-0.5 rounded-md border border-border p-1">
                  {candidates.map(c => (
                    <button key={c.placeId} type="button" onClick={() => pick(c)} className="rounded px-2 py-1.5 text-left text-sm hover:bg-muted">
                      <span className="font-medium">{c.name}</span>
                      {c.address && <span className="block text-xs text-muted-foreground">{c.address}</span>}
                    </button>
                  ))}
                </div>
              )}
              <button type="button" onClick={() => setManual(true)} className="self-start text-xs text-primary hover:underline">
                Can&apos;t find it? Enter a Place ID manually
              </button>
            </>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Search your business to connect it — this pulls live reviews and identifies you in map-pack rank checks. A brand-new Business Profile can take days to become searchable here; until then, paste its Place ID manually.
          </p>
        </div>

        <div className="grid gap-1.5 rounded-md border border-border bg-muted/30 p-3">
          <Label>Search locations — one city per line</Label>
          <Textarea
            value={locationsText}
            onChange={e => setLocationsText(e.target.value)}
            rows={3}
            placeholder={"Tampa,Florida,United States\nSt. Petersburg,Florida,United States"}
          />
          <p className="text-xs leading-relaxed text-muted-foreground">
            Google Maps rank changes by where the searcher is, so we check from each city you list here. Add one per line in <span className="font-medium text-foreground">City,State,Country</span> format. Every keyword below is checked from <span className="font-medium text-foreground">each</span> location.
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label>Map-pack keywords</Label>
          <Input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="plumber, emergency plumber, water heater repair" />
          <p className="text-xs leading-relaxed text-muted-foreground">Comma-separated. We check your Google Maps 3-pack position for each, from every location above.</p>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border p-4">
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    </Modal>
  )
}

export default function LocalPresence() {
  const { clientId, client } = useClientCtx()
  const { data: me } = useSWR('me', api.me)
  const isSuperadmin = me?.isSuperadmin ?? false
  const [configOpen, setConfigOpen] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Local presence</h2>
          <p className="text-sm text-muted-foreground">
            Your Google Business Profile activity and directory listings across the web.
          </p>
        </div>
        {isSuperadmin && (
          <Button variant="outline" size="sm" onClick={() => setConfigOpen(true)}>
            <Settings2 className="h-3.5 w-3.5" /> Configure
          </Button>
        )}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <ReviewsCard clientId={clientId} isSuperadmin={isSuperadmin} placeId={client?.portalConfig?.placeId} onConfigure={() => setConfigOpen(true)} />
        <MapRankCard clientId={clientId} isSuperadmin={isSuperadmin} hasKeywords={!!client?.portalConfig?.localKeywords?.length} onConfigure={() => setConfigOpen(true)} />
      </div>
      <GbpCard clientId={clientId} isSuperadmin={isSuperadmin} />
      <CitationsCard clientId={clientId} isSuperadmin={isSuperadmin} />
      <LocalConfigModal clientId={clientId} open={configOpen} onClose={() => setConfigOpen(false)} />
    </div>
  )
}
