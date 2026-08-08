import { useEffect, useState } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import {
  Target, Search, Download, Sparkles, Copy, Globe, GlobeLock, Star, ChevronDown, ChevronRight,
  Image as ImageIcon, Link2, EyeOff, Upload, Trash2, Palette, ExternalLink, FlaskConical, X, Plus,
} from 'lucide-react'
import { api } from '@/lib/api'
import type {
  Prospect, ProspectCandidate, ProspectStatus, SeoCrawl, ProspectMockup, ProspectPreview, DesignReference,
  MockupPreview,
} from '@/lib/api'
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

      <DesignLibrary />

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

// ── Design library ───────────────────────────────────────────────────────────
// Concept generation has no built-in taste and no fixed templates — it imitates
// what's uploaded here and nothing else. An empty library means generated pages
// fall back to whatever the model reaches for by default, which is exactly what
// this exists to prevent.
//
// References are organized into operator-named libraries (e.g. "Roofing",
// "Med Spa") so a specific one can be chosen per prospect at generation time —
// see the library picker in MockupPanel below. A reference with no library
// sits in the "Unassigned" pool, which is what gets used when a prospect's
// generation doesn't have a library chosen either.
const DESIGN_REFS_KEY = 'design-references'
const DESIGN_LIBS_KEY = 'design-libraries'
const UNASSIGNED = '__unassigned__' // sentinel for "no library" in <select>s

// Exported so MockupPanel's library picker (same data, different purpose) can
// share one SWR cache instead of a second fetch.
export function useDesignLibraries() {
  return useSWR(DESIGN_LIBS_KEY, () => api.prospecting.designLibraries())
}

// Compact manager: add a library by name, rename/delete existing ones. Kept
// terse since this is a superadmin-only tool — no dedicated page needed.
function LibraryManager() {
  const { data: libraries } = useDesignLibraries()
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  async function add() {
    const trimmed = name.trim()
    if (!trimmed) return
    setAdding(true)
    try {
      await api.prospecting.createDesignLibrary(trimmed)
      setName('')
      mutate(DESIGN_LIBS_KEY)
      toast.success(`"${trimmed}" library created`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create library')
    } finally {
      setAdding(false)
    }
  }

  async function rename(id: string) {
    const trimmed = editingName.trim()
    setEditingId(null)
    if (!trimmed) return
    try {
      await api.prospecting.updateDesignLibrary(id, { name: trimmed })
      mutate(DESIGN_LIBS_KEY)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to rename library')
    }
  }

  async function remove(id: string) {
    try {
      await api.prospecting.deleteDesignLibrary(id)
      mutate(DESIGN_LIBS_KEY)
      mutate(DESIGN_REFS_KEY)
      toast.success('Library deleted — its references are now unassigned')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete library')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {libraries?.map(lib => (
          <div key={lib.id} className="group flex items-center gap-1 rounded-full border border-border py-0.5 pl-2.5 pr-1 text-xs">
            {editingId === lib.id ? (
              <input
                autoFocus
                value={editingName}
                onChange={e => setEditingName(e.target.value)}
                onBlur={() => rename(lib.id)}
                onKeyDown={e => { if (e.key === 'Enter') rename(lib.id); if (e.key === 'Escape') setEditingId(null) }}
                className="h-5 w-28 border-b border-primary bg-transparent outline-none"
              />
            ) : (
              <button
                onClick={() => { setEditingId(lib.id); setEditingName(lib.name) }}
                className="font-medium hover:underline"
                title="Click to rename"
              >
                {lib.name} <span className="text-muted-foreground">({lib.referenceCount ?? 0})</span>
              </button>
            )}
            <button
              onClick={() => remove(lib.id)}
              aria-label={`Delete ${lib.name} library`}
              className="rounded-full p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
        {!libraries?.length && <span className="text-xs text-muted-foreground">No libraries yet — add one below.</span>}
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder="New library name — e.g. Roofing, Med Spa"
          className="h-7 w-56 text-xs"
        />
        <Button variant="outline" size="sm" onClick={add} disabled={adding || !name.trim()} className="h-7 px-2 text-xs">
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>
    </div>
  )
}

function DesignLibrary() {
  const { data: libraries } = useDesignLibraries()
  const [filter, setFilter] = useState<string>('') // '' = all, UNASSIGNED, or a library id
  const { data: references } = useSWR(
    [DESIGN_REFS_KEY, filter],
    () => api.prospecting.designReferences({ libraryId: filter || undefined })
  )
  const [uploading, setUploading] = useState(false)
  const [uploadLibraryId, setUploadLibraryId] = useState('')
  const [notes, setNotes] = useState('')

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        await api.prospecting.uploadDesignReference(file, {
          libraryId: uploadLibraryId && uploadLibraryId !== UNASSIGNED ? uploadLibraryId : undefined,
          notes: notes.trim() || undefined,
        })
      }
      mutate([DESIGN_REFS_KEY, filter])
      mutate(DESIGN_LIBS_KEY) // reference counts changed
      setNotes('')
      toast.success(files.length === 1 ? 'Reference added' : `${files.length} references added`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function remove(refId: string) {
    try {
      await api.prospecting.deleteDesignReference(refId)
      mutate([DESIGN_REFS_KEY, filter])
      mutate(DESIGN_LIBS_KEY)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Palette className="h-4 w-4" />Design library ({references?.length ?? 0})</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <p className="text-sm text-muted-foreground">
          Upload designs you want concepts to look like — Figma comps, screenshots of sites you admire,
          anything visual. Generated concepts imitate these. Organize them into libraries below, then
          choose the right one per prospect when generating a concept; unassigned references are the
          default pool for prospects with no library chosen.
        </p>

        <LibraryManager />

        <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center">
          <label className="text-xs text-muted-foreground">Showing:</label>
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">All references</option>
            <option value={UNASSIGNED}>Unassigned only</option>
            {libraries?.map(lib => <option key={lib.id} value={lib.id}>{lib.name}</option>)}
          </select>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={uploadLibraryId}
            onChange={e => setUploadLibraryId(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs sm:w-56"
          >
            <option value="">Unassigned</option>
            {libraries?.map(lib => <option key={lib.id} value={lib.id}>{lib.name}</option>)}
          </select>
          <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes — e.g. love the hero spacing, ignore the colours" className="h-8 flex-1" />
        </div>

        <label className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border py-6 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground ${uploading ? 'pointer-events-none opacity-60' : ''}`}>
          <Upload className="h-4 w-4" />
          {uploading ? 'Uploading…' : 'Drop images here, or click to choose'}
          <span className="text-xs">PNG, JPEG, WebP or GIF — the library and notes above are applied to this batch</span>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple className="hidden" onChange={e => { uploadFiles(e.target.files); e.target.value = '' }} />
        </label>

        {references?.length
          ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {references.map(r => (
                <DesignReferenceCard
                  key={r.id}
                  reference={r}
                  libraryName={libraries?.find(l => l.id === r.libraryId)?.name ?? null}
                  onDelete={() => remove(r.id)}
                />
              ))}
            </div>
          )
          : (
            <EmptyState
              icon={Palette}
              title="No design references yet"
              description="Concepts generated with an empty library follow the model's default taste rather than yours. Add a few examples first."
            />
          )}
      </CardContent>
    </Card>
  )
}

function DesignReferenceCard({ reference, libraryName, onDelete }: { reference: DesignReference; libraryName: string | null; onDelete: () => void }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    api.prospecting.designReferenceImageUrl(reference.id)
      .then(u => {
        if (cancelled) { URL.revokeObjectURL(u); return }
        objectUrl = u
        setUrl(u)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [reference.id])

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-md border border-border">
      {url
        ? <img src={url} alt={reference.label} className="aspect-[4/3] w-full bg-muted object-cover" />
        : <div className="aspect-[4/3] w-full animate-pulse bg-muted" />}
      <div className="flex flex-col gap-0.5 px-2 py-1.5">
        <span className="truncate text-xs font-medium">{reference.label}</span>
        <Badge variant="outline" className="w-fit text-[10px]">{libraryName ?? 'Unassigned'}</Badge>
        {reference.notes && <span className="line-clamp-2 text-[11px] text-muted-foreground">{reference.notes}</span>}
      </div>
      <button
        onClick={onDelete}
        aria-label={`Delete ${reference.label}`}
        className="absolute right-1.5 top-1.5 rounded-md bg-background/90 p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// Click once to arm ("Confirm?"), click again within 3s to actually delete.
// A hard delete cascades to the prospect's mockups and preview links, so this
// avoids a separate modal while still requiring a deliberate second click.
function DeleteButton({ name, onConfirm }: { name: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])

  if (armed) {
    return (
      <button
        onClick={() => { setArmed(false); onConfirm() }}
        aria-label={`Confirm delete ${name}`}
        className="flex h-8 shrink-0 items-center gap-1 rounded-md border border-destructive bg-destructive/10 px-2 text-xs font-medium text-destructive"
      >
        <Trash2 className="h-3 w-3" /> Confirm?
      </button>
    )
  }

  return (
    <button
      onClick={() => setArmed(true)}
      aria-label={`Delete ${name}`}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
    >
      <Trash2 className="h-3.5 w-3.5" />
    </button>
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

  async function remove() {
    try {
      await api.prospecting.delete(prospect.id)
      toast.success(`${prospect.name} removed`)
      mutate(PROSPECTS_KEY)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove prospect')
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
        <DeleteButton name={prospect.name} onConfirm={remove} />
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

          {/* Attaches the audit only once it's finished, so a preview link
              never points at a still-running or failed crawl. */}
          <MockupPanel
            prospect={prospect}
            latestCrawlId={audit?.status === 'finished' ? audit.id : null}
          />
        </div>
      )}
    </div>
  )
}

// Auth-gated image: the API needs a bearer token, so it can't be a plain
// <img src>. Fetches to an object URL and revokes it on unmount. Only legacy
// image-format mockups reach this — HTML concepts render in ConceptPreview.
function MockupImage({ mockupId }: { mockupId: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    api.prospecting.mockupImageUrl(mockupId)
      .then(u => {
        if (cancelled) { URL.revokeObjectURL(u); return }
        objectUrl = u
        setUrl(u)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [mockupId])

  if (!url) return <div className="h-48 animate-pulse rounded-md bg-muted" />
  return <img src={url} alt="Homepage concept" className="w-full rounded-md border border-border" />
}

// The generated page, rendered from the HTML already on the mockup row — no
// second fetch needed. srcDoc rather than a src URL so this works without the
// concept being publicly addressable; sandboxed with no allow-* tokens because
// it's model-authored markup.
function ConceptPreview({ mockup }: { mockup: ProspectMockup }) {
  function openInTab() {
    const blob = new Blob([mockup.html ?? ''], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener')
    // The tab has loaded the blob by the time this fires; holding the URL
    // longer just leaks it for the life of the session.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return (
    <div className="flex flex-col gap-1.5">
      <iframe
        srcDoc={mockup.html ?? ''}
        sandbox=""
        title="Homepage concept"
        className="h-[420px] w-full rounded-md border border-border bg-white"
      />
      <button onClick={openInTab} className="flex w-fit items-center gap-1 text-xs text-primary hover:underline">
        <ExternalLink className="h-3 w-3" /> Open full size
      </button>
    </div>
  )
}

// The concept image + the shareable link. Deliberately no send button: the
// operator copies the link into the email they send from their own inbox,
// exactly as they already do with the drafts above.
function MockupPanel({ prospect, latestCrawlId }: { prospect: Prospect; latestCrawlId: string | null }) {
  const mockupsKey = ['prospect-mockups', prospect.id]
  const previewsKey = ['prospect-previews', prospect.id]
  const { data: mockups } = useSWR(mockupsKey, () => api.prospecting.mockups(prospect.id))
  const { data: previews } = useSWR(previewsKey, () => api.prospecting.previews(prospect.id))
  const { data: libraries } = useDesignLibraries()
  const [notes, setNotes] = useState('')
  // '' means "no library" — falls back to the unassigned pool server-side.
  // Pre-select whichever library's name best matches this prospect's Places
  // category (e.g. "Roofing" ~ "Roofing contractor"), but this is only a
  // starting point — always overridable before generating.
  const [libraryId, setLibraryId] = useState('')
  const [libraryTouched, setLibraryTouched] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [linking, setLinking] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [promptPreview, setPromptPreview] = useState<MockupPreview | null>(null)

  useEffect(() => {
    if (libraryTouched || !libraries?.length || !prospect.category) return
    const category = prospect.category.toLowerCase()
    const match = libraries.find(lib => category.includes(lib.name.toLowerCase()) || lib.name.toLowerCase().includes(category))
    if (match) setLibraryId(match.id)
  }, [libraries, prospect.category, libraryTouched])

  const latest: ProspectMockup | undefined = mockups?.[0]
  const activePreview: ProspectPreview | undefined = previews?.find(p => !p.revokedAt)

  async function generate() {
    setGenerating(true)
    try {
      await api.prospecting.generateMockup(prospect.id, { directionNotes: notes.trim() || undefined, libraryId: libraryId || null })
      mutate(mockupsKey)
      toast.success('Concept generated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate concept')
    } finally {
      setGenerating(false)
    }
  }

  // No Claude call — assembles the same prompt + images generateMockup would
  // send and stops there, so this costs zero tokens. Paste the result into a
  // free tool (ChatGPT, Gemini) to sanity-check the design library before
  // spending real generations.
  async function previewPrompt() {
    setPreviewing(true)
    try {
      setPromptPreview(await api.prospecting.previewMockup(prospect.id, { directionNotes: notes.trim() || undefined, libraryId: libraryId || null }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to build preview')
    } finally {
      setPreviewing(false)
    }
  }

  async function createLink() {
    if (!latest) return
    setLinking(true)
    try {
      await api.prospecting.createPreview(prospect.id, { mockupId: latest.id, crawlId: latestCrawlId })
      mutate(previewsKey)
      toast.success('Preview link created')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create link')
    } finally {
      setLinking(false)
    }
  }

  async function revoke(previewId: string) {
    try {
      await api.prospecting.revokePreview(previewId)
      mutate(previewsKey)
      toast.success('Link revoked')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke link')
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={generate} disabled={generating}>
          <ImageIcon className="h-3.5 w-3.5" />
          {generating ? 'Generating…' : latest ? 'Regenerate concept' : 'Generate concept'}
        </Button>
        {latest && (
          <Button variant="outline" size="sm" onClick={createLink} disabled={linking}>
            <Link2 className="h-3.5 w-3.5" />{linking ? 'Creating…' : 'Create preview link'}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={previewPrompt} disabled={previewing}>
          <FlaskConical className="h-3.5 w-3.5" />{previewing ? 'Building…' : 'Preview prompt (free)'}
        </Button>
        <select
          value={libraryId}
          onChange={e => { setLibraryId(e.target.value); setLibraryTouched(true) }}
          title="Which design library to imitate for this prospect's concept"
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="">No library (unassigned pool)</option>
          {libraries?.map(lib => <option key={lib.id} value={lib.id}>{lib.name} ({lib.referenceCount ?? 0})</option>)}
        </select>
        <Input
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="direction (optional) — e.g. warmer, less corporate"
          className="h-8 w-72"
        />
      </div>

      {promptPreview && <PromptPreviewPanel preview={promptPreview} onClose={() => setPromptPreview(null)} />}

      {latest && (latest.format === 'html' ? <ConceptPreview mockup={latest} /> : <MockupImage mockupId={latest.id} />)}
      {!latest && (
        <p className="text-xs text-muted-foreground">
          A full “here’s what your homepage could look like” page, generated from the design library above and
          shown next to a screenshot of their current site. Review it before sharing the link.
        </p>
      )}

      {activePreview && (
        <div className="flex items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
          <span className="flex-1 truncate font-mono">{activePreview.url}</span>
          <button onClick={() => copyText(activePreview.url)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <Copy className="h-3 w-3" /> Copy
          </button>
          <a href={activePreview.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">Open</a>
          <button onClick={() => revoke(activePreview.id)} className="flex items-center gap-1 text-muted-foreground hover:text-destructive">
            <EyeOff className="h-3 w-3" /> Revoke
          </button>
        </div>
      )}
      {activePreview && (
        <p className="text-xs text-muted-foreground">
          Opened {activePreview.viewCount}×
          {activePreview.lastViewedAt ? ` — last ${new Date(activePreview.lastViewedAt).toLocaleString()}` : ' — not yet opened'}
          . Paste this link into the email you send yourself.
        </p>
      )}
    </div>
  )
}

// Everything generateMockup() would send to Claude, minus the actual call —
// paste combinedPrompt into a free chat tool, drag in the images, and see
// what the current design library + prompt produces before spending a real
// generation on it.
function PromptPreviewPanel({ preview, onClose }: { preview: MockupPreview; onClose: () => void }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-dashed border-primary/40 bg-primary/5 p-3">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
          <FlaskConical className="h-3.5 w-3.5" /> Prompt preview — no tokens spent
        </span>
        <button onClick={onClose} aria-label="Close preview" className="text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Paste the prompt below as your first message in ChatGPT or Gemini (free tier), attach the images
        in order, and send. Compare what comes back to the design references before spending a real
        generation here.
      </p>

      <div className="flex flex-col rounded-md border border-border bg-background">
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <span className="text-xs font-medium text-muted-foreground">Prompt (system + user, combined)</span>
          <button onClick={() => copyText(preview.combinedPrompt)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <Copy className="h-3 w-3" /> Copy
          </button>
        </div>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap px-3 py-2 font-sans text-xs leading-relaxed">{preview.combinedPrompt}</pre>
      </div>

      {preview.images.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            Images, in the order they're sent ({preview.images.length})
          </span>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {preview.images.map((img, i) => (
              <div key={i} className="flex flex-col overflow-hidden rounded-md border border-border bg-background">
                <img src={img.dataUrl} alt={img.caption} className="aspect-[4/3] w-full object-cover" />
                <div className="flex flex-col gap-1 px-2 py-1.5">
                  <span className="line-clamp-2 text-[11px] text-muted-foreground">{img.caption}</span>
                  <a href={img.dataUrl} download={img.filename} className="flex w-fit items-center gap-1 text-[11px] font-medium text-primary hover:underline">
                    <Download className="h-3 w-3" /> Download
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {preview.images.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No images will be sent — the chosen library (or the unassigned pool, if none was chosen) has
          no references, and no screenshot of their current site was captured.
        </p>
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
