import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { Target, Search, Download, Sparkles, Copy, Globe, GlobeLock, Star, ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import type { Prospect, ProspectCandidate, ProspectStatus, SeoCrawl } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/empty-state'
import { AuditReport } from '@/components/audit-report'

// Superadmin cold-outreach tool. Find local businesses via Google Places, draft
// a personalized outreach email for each, and export a list you send yourself
// from your own inbox. Manual only — the platform never sends anything here.
const PROSPECTS_KEY = 'prospects'

const STATUS_OPTIONS: ProspectStatus[] = [
  'new', 'saved', 'drafted', 'sent', 'replied', 'won', 'lost', 'do_not_contact',
]

function statusVariant(status: ProspectStatus) {
  switch (status) {
    case 'won': return 'success' as const
    case 'replied': return 'default' as const
    case 'sent': case 'drafted': return 'secondary' as const
    case 'lost': case 'do_not_contact': return 'destructive' as const
    default: return 'outline' as const
  }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard')
  } catch {
    toast.error('Could not copy — select and copy manually')
  }
}

export default function Prospecting() {
  const [category, setCategory] = useState('med spa')
  const [area, setArea] = useState('Tampa, FL')
  const [noWebsiteOnly, setNoWebsiteOnly] = useState(false)
  const [minRating, setMinRating] = useState('')
  const [searching, setSearching] = useState(false)
  const [candidates, setCandidates] = useState<ProspectCandidate[] | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const { data: prospects } = useSWR(PROSPECTS_KEY, () => api.prospecting.list())
  const savedPlaceIds = new Set((prospects ?? []).map(p => p.placeId).filter(Boolean))

  async function search() {
    if (!category.trim() || !area.trim()) return
    setSearching(true)
    setCandidates(null)
    try {
      const res = await api.prospecting.discover({
        category: category.trim(),
        area: area.trim(),
        noWebsiteOnly,
        minRating: minRating ? Number(minRating) : undefined,
      })
      setCandidates(res.candidates)
      toast.success(`Found ${res.count} ${res.count === 1 ? 'business' : 'businesses'}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  async function save(candidate: ProspectCandidate) {
    setSaving(candidate.placeId)
    try {
      await api.prospecting.save(candidate, category.trim(), area.trim())
      toast.success(`Saved ${candidate.name}`)
      mutate(PROSPECTS_KEY)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(null)
    }
  }

  async function exportCsv() {
    try {
      const csv = await api.prospecting.exportCsv()
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'prospects.csv'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Prospecting</h1>
        <p className="text-sm text-muted-foreground">
          Find local businesses, draft a personalized outreach email for each, and export a list you send
          yourself from your own inbox. Manual only — nothing here sends automatically.
        </p>
      </div>

      {/* ── Find prospects ── */}
      <Card>
        <CardHeader><CardTitle>Find prospects</CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input value={category} onChange={e => setCategory(e.target.value)} placeholder="Category (e.g. med spa)" className="flex-1" disabled={searching} />
            <Input value={area} onChange={e => setArea(e.target.value)} placeholder="Area (e.g. Tampa, FL)" className="flex-1" disabled={searching} onKeyDown={e => { if (e.key === 'Enter') search() }} />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" checked={noWebsiteOnly} onChange={e => setNoWebsiteOnly(e.target.checked)} className="accent-primary" />
              No website only <span className="text-xs">(prime "we'll build you one" targets)</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              Min rating
              <Input value={minRating} onChange={e => setMinRating(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="4.0" className="h-8 w-20" />
            </label>
            <Button onClick={search} disabled={searching || !category.trim() || !area.trim()} className="ml-auto">
              <Search className="h-3.5 w-3.5" />{searching ? 'Searching…' : 'Search'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Discovery results ── */}
      {candidates && (
        <Card>
          <CardHeader><CardTitle>Results ({candidates.length})</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {candidates.length === 0 ? (
              <EmptyState icon={Search} title="No matches" description="Try a broader category, a different area, or relax the filters." />
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {candidates.map(c => {
                  const alreadySaved = savedPlaceIds.has(c.placeId)
                  return (
                    <div key={c.placeId} className="flex items-center gap-3 py-2.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{c.name}</span>
                          {c.noWebsite
                            ? <Badge variant="warning" className="gap-1"><GlobeLock className="h-3 w-3" />No website</Badge>
                            : <Badge variant="outline" className="gap-1"><Globe className="h-3 w-3" />Has site</Badge>}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          {c.rating != null && <span className="flex items-center gap-0.5"><Star className="h-3 w-3 fill-current" />{c.rating} ({c.reviewCount})</span>}
                          {c.phone && <span>{c.phone}</span>}
                          {c.address && <span className="truncate">{c.address}</span>}
                        </div>
                      </div>
                      <Button variant={alreadySaved ? 'ghost' : 'outline'} size="sm" disabled={alreadySaved || saving === c.placeId} onClick={() => save(c)}>
                        {alreadySaved ? 'Saved' : saving === c.placeId ? 'Saving…' : 'Save'}
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Saved prospects ── */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Saved prospects ({prospects?.length ?? 0})</CardTitle>
          {!!prospects?.length && (
            <button onClick={exportCsv} className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm font-medium hover:bg-muted">
              <Download className="h-3.5 w-3.5" /> Export CSV
            </button>
          )}
        </CardHeader>
        <CardContent className="pt-0">
          {prospects?.length
            ? <div className="flex flex-col divide-y divide-border">{prospects.map(p => <ProspectRow key={p.id} prospect={p} />)}</div>
            : <EmptyState icon={Target} title="No saved prospects yet" description="Search above and save the good ones to start building your outreach list." />}
        </CardContent>
      </Card>
    </div>
  )
}

function ProspectRow({ prospect }: { prospect: Prospect }) {
  const [expanded, setExpanded] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [auditing, setAuditing] = useState(false)
  const [audit, setAudit] = useState<SeoCrawl | null>(null)
  const [email, setEmail] = useState(prospect.email ?? '')

  async function generateDrafts() {
    setDrafting(true)
    try {
      await api.prospecting.generateDrafts(prospect.id)
      toast.success('Drafts generated')
      setExpanded(true)
      mutate(PROSPECTS_KEY)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate drafts')
    } finally {
      setDrafting(false)
    }
  }

  async function runAudit() {
    setAuditing(true)
    setAudit(null)
    try {
      let current = await api.prospecting.audit(prospect.id)
      setAudit(current)
      while (current.status === 'running') {
        await new Promise(r => setTimeout(r, 6000))
        current = await api.overview.refreshAudit(current.id)
        setAudit(current)
      }
      if (current.status === 'failed') toast.error(current.error ?? 'Audit failed')
      else toast.success('Audit complete')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Audit failed')
    } finally {
      setAuditing(false)
    }
  }

  async function setStatus(status: ProspectStatus) {
    try {
      await api.prospecting.update(prospect.id, { status })
      mutate(PROSPECTS_KEY)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status')
    }
  }

  async function saveEmail() {
    if (email === (prospect.email ?? '')) return
    try {
      await api.prospecting.update(prospect.id, { email: email.trim() || null })
      toast.success('Email saved')
      mutate(PROSPECTS_KEY)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save email')
    }
  }

  return (
    <div className="py-3 text-sm">
      <div className="flex items-center gap-3">
        <button onClick={() => setExpanded(e => !e)} className="text-muted-foreground hover:text-foreground">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{prospect.name}</span>
            {prospect.noWebsite
              ? <Badge variant="warning" className="gap-1"><GlobeLock className="h-3 w-3" />No website</Badge>
              : <Badge variant="outline" className="gap-1"><Globe className="h-3 w-3" />Has site</Badge>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
            {prospect.rating != null && <span className="flex items-center gap-0.5"><Star className="h-3 w-3 fill-current" />{prospect.rating} ({prospect.reviewCount})</span>}
            {prospect.phone && <span>{prospect.phone}</span>}
            {prospect.website && <a href={prospect.website} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">{prospect.website}</a>}
          </div>
        </div>
        <select
          value={prospect.status}
          onChange={e => setStatus(e.target.value as ProspectStatus)}
          className="h-8 rounded-md border border-border bg-background px-2 text-xs"
        >
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </select>
        <Badge variant={statusVariant(prospect.status)} className="hidden sm:inline-flex">{prospect.status.replace(/_/g, ' ')}</Badge>
      </div>

      {expanded && (
        <div className="mt-3 flex flex-col gap-3 pl-7">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={generateDrafts} disabled={drafting}>
              <Sparkles className="h-3.5 w-3.5" />{drafting ? 'Drafting…' : prospect.draftPlain ? 'Regenerate drafts' : 'Generate drafts'}
            </Button>
            {prospect.website && (
              <Button variant="outline" size="sm" onClick={runAudit} disabled={auditing}>
                <Search className="h-3.5 w-3.5" />{auditing ? 'Auditing…' : 'Audit site'}
              </Button>
            )}
            <div className="flex items-center gap-1.5">
              <Input value={email} onChange={e => setEmail(e.target.value)} onBlur={saveEmail} placeholder="email (manual)" className="h-8 w-52" />
            </div>
          </div>

          {(prospect.draftPlain || prospect.draftLoom) && (
            <div className="grid gap-3 lg:grid-cols-2">
              {prospect.draftPlain && <DraftBox label="Plain email" text={prospect.draftPlain} />}
              {prospect.draftLoom && <DraftBox label="With Loom video" text={prospect.draftLoom} />}
            </div>
          )}

          {audit && (
            <div className="rounded-md border border-border p-3">
              {audit.status === 'running' && <p className="text-sm text-muted-foreground">Crawling{audit.pagesCrawled ? ` — ${audit.pagesCrawled} pages` : ''}… about a minute.</p>}
              {audit.status === 'failed' && <p className="text-sm text-destructive">{audit.error ?? 'Audit failed'}</p>}
              {audit.status === 'finished' && <AuditReport crawl={audit} showCost />}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DraftBox({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col rounded-md border border-border">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <button onClick={() => copyText(text)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <Copy className="h-3 w-3" /> Copy
        </button>
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap px-3 py-2 font-sans text-xs leading-relaxed">{text}</pre>
    </div>
  )
}
