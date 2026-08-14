import { useEffect, useMemo, useState } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import {
  Target, Search, Download, Sparkles, Copy, Globe, GlobeLock, Star, ChevronDown, ChevronRight,
  Image as ImageIcon, Link2, EyeOff, Upload, Trash2, Palette, ExternalLink, FlaskConical, X, Plus,
  Wand2, Check, Loader2, Mail,
} from 'lucide-react'
import { api, UNGROUPED_KEY, formatCost, UNASSIGNED_LIBRARY } from '@/lib/api'
import { useConfirm } from '@/components/confirm-dialog'
import type {
  Prospect, ProspectCandidate, ProspectStatus, SeoCrawl, ProspectMockup, ProspectPreview, DesignReference,
  MockupPreview, ExtractedBrand, GenerationRun, RunStep, CostItem, LayoutFinding,
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

const PAGE_SIZES = [10, 25, 50, 100]

// Sentinel key for prospects with no group, so the display map can distinguish
// "ungrouped" from a group the operator actually named "Ungrouped".
const NO_GROUP = '__no_group__'

function titleCase(s: string) {
  return s.trim().replace(/\b\w/g, c => c.toUpperCase())
}

// Shared by both export buttons (whole list, and one group).
async function downloadCsv(filter: { group?: string } = {}, filename = 'prospects.csv') {
  try {
    const csv = await api.prospecting.exportCsv(filter)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Export failed')
  }
}

// A route switch unmounts this whole component (React Router default), which
// would otherwise wipe an in-progress review of 60 search results — including
// the page/filter/selection UI — the moment the operator glances at another
// tab. The module itself stays loaded across that unmount, so a plain
// module-scope variable (read once on mount, written on every search)
// survives navigating away and back; a full page reload still clears it, same
// as any other in-memory state.
interface SearchState {
  candidates: ProspectCandidate[]
  searched: { category: string; area: string }
  fromCache: boolean
  fetchedAt: string
}
let lastSearch: SearchState | null = null

export default function Prospecting() {
  const [category, setCategory] = useState('med spa')
  const [area, setArea] = useState('Tampa, FL')
  const [noWebsiteOnly, setNoWebsiteOnly] = useState(false)
  const [minRating, setMinRating] = useState('')
  const [searching, setSearching] = useState(false)
  const [state, setState] = useState<SearchState | null>(() => lastSearch)

  const { data: prospects } = useSWR(PROSPECTS_KEY, () => api.prospecting.list())

  // API caches the underlying Places call per (category, area) for a day —
  // Places bills per search, not per result, so re-running the same search
  // (or just tightening a filter) doesn't cost anything unless forceRefresh
  // asks for a real re-check.
  async function search(forceRefresh = false) {
    if (!category.trim() || !area.trim()) return
    setSearching(true)
    try {
      const terms = { category: category.trim(), area: area.trim() }
      const res = await api.prospecting.discover({
        ...terms,
        noWebsiteOnly,
        minRating: minRating ? Number(minRating) : undefined,
        forceRefresh,
      })
      const next: SearchState = { candidates: res.candidates, searched: terms, fromCache: res.fromCache, fetchedAt: res.fetchedAt }
      setState(next)
      lastSearch = next
      toast.success(
        `Found ${res.count} ${res.count === 1 ? 'business' : 'businesses'}`
        + (res.fromCache ? ' (cached — no API call)' : '')
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setSearching(false)
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
            <Button onClick={() => search()} disabled={searching || !category.trim() || !area.trim()} className="ml-auto">
              <Search className="h-3.5 w-3.5" />{searching ? 'Searching…' : 'Search'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <HtmlPastePreview />

      {/* ── Discovery results ── */}
      {state && (
        <DiscoveryResults
          candidates={state.candidates}
          searched={state.searched}
          fromCache={state.fromCache}
          fetchedAt={state.fetchedAt}
          onRefresh={() => search(true)}
          searching={searching}
          savedPlaceIds={new Set((prospects ?? []).map(p => p.placeId).filter(Boolean) as string[])}
        />
      )}

      <DesignLibrary />

      <SavedProspects prospects={prospects} />
    </div>
  )
}

// ChatGPT/Gemini wrap code in markdown fences (```html ... ```) even when
// told not to, and stray text before <!doctype html> breaks how a browser
// parses the document — instead of rendering, it dumps the content as plain
// text. Mirrors stripCodeFence() in the API's prospect-mockups.ts (which
// strips a real Claude generation the same way), but more lenient since
// pasted text is copied by hand: strips a fence wherever it appears rather
// than requiring it to exactly bookend the string, and falls back to
// slicing from the first real <!doctype html>/<html> if the model added any
// preamble ("Here's the HTML:") before the fence.
function stripCodeFence(text: string): string {
  let trimmed = text.trim()
  trimmed = trimmed.replace(/^```[a-zA-Z]*\s*\n/, '').replace(/\n?```\s*$/, '').trim()
  const docStart = trimmed.search(/<!doctype html|<html/i)
  if (docStart > 0) trimmed = trimmed.slice(docStart)
  return trimmed
}

// ── Paste & preview HTML ─────────────────────────────────────────────────────
// Renders arbitrary HTML client-side — no server round trip, no persistence.
// For eyeballing a concept generated for free elsewhere (paste the "Preview
// prompt (free)" output into ChatGPT/Gemini, paste the HTML it hands back
// here) before ever spending a real Claude generation on it. Same sandboxed
// iframe pattern as ConceptPreview below, so what you see here matches how a
// real generation would actually render.
function HtmlPastePreview() {
  const [html, setHtml] = useState('')
  const [rendered, setRendered] = useState('')
  const [fenceStripped, setFenceStripped] = useState(false)

  function render() {
    const cleaned = stripCodeFence(html)
    setFenceStripped(cleaned !== html.trim())
    setRendered(cleaned)
  }

  function openInTab() {
    const blob = new Blob([rendered], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return (
    <Card>
      <CardHeader><CardTitle>Test HTML</CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0">
        <p className="text-sm text-muted-foreground">
          Paste a full HTML document here to render it — no cost, nothing saved. Useful for eyeballing a
          concept you generated for free in ChatGPT/Gemini using the "Preview prompt (free)" output above.
          Markdown code fences (```html) are stripped automatically.
        </p>
        <textarea
          value={html}
          onChange={e => setHtml(e.target.value)}
          placeholder="Paste a full <!doctype html> ... </html> document here"
          className="h-32 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={render} disabled={!html.trim()}>Render</Button>
          {fenceStripped && <span className="text-xs text-muted-foreground">Stripped a markdown code fence before rendering.</span>}
          {rendered && (
            <button onClick={openInTab} className="flex items-center gap-1 text-xs text-primary hover:underline">
              <ExternalLink className="h-3 w-3" /> Open full size
            </button>
          )}
        </div>
        {rendered && (
          <iframe
            srcDoc={rendered}
            sandbox=""
            title="Pasted HTML preview"
            className="h-[600px] w-full rounded-md border border-border bg-white"
          />
        )}
      </CardContent>
    </Card>
  )
}

// ── Discovery results ────────────────────────────────────────────────────────
// A 60-result search is too long to scan as one list, so this pages it, lets
// the operator narrow by name, and hides businesses already saved (Places
// returns them regardless — it charges per search, not per result — so this is
// a review-time filter, not a cost saving). Checkbox selection feeds one bulk
// save rather than 40 individual clicks.
function DiscoveryResults({ candidates, searched, fromCache, fetchedAt, onRefresh, searching, savedPlaceIds }: {
  candidates: ProspectCandidate[]
  searched: { category: string; area: string }
  fromCache: boolean
  fetchedAt: string
  onRefresh: () => void
  searching: boolean
  savedPlaceIds: Set<string>
}) {
  const [filter, setFilter] = useState('')
  const [hideSaved, setHideSaved] = useState(true)
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [groupName, setGroupName] = useState(titleCase(searched.category))
  const [savingBulk, setSavingBulk] = useState(false)
  const [savingOne, setSavingOne] = useState<string | null>(null)

  // A new search invalidates both the selection and the default group label.
  useEffect(() => {
    setSelected(new Set())
    setGroupName(titleCase(searched.category))
  }, [searched])

  // Any change to what's listed can shrink the list out from under the current
  // page, so land back at the top rather than on a blank page.
  useEffect(() => { setPage(0) }, [filter, hideSaved, pageSize, candidates])

  const query = filter.trim().toLowerCase()
  const shown = candidates.filter(c => {
    if (hideSaved && savedPlaceIds.has(c.placeId)) return false
    if (query && !c.name.toLowerCase().includes(query) && !(c.address ?? '').toLowerCase().includes(query)) return false
    return true
  })
  const savedCount = candidates.filter(c => savedPlaceIds.has(c.placeId)).length

  const pageCount = Math.max(1, Math.ceil(shown.length / pageSize))
  const current = Math.min(page, pageCount - 1)
  const pageRows = shown.slice(current * pageSize, current * pageSize + pageSize)

  // Already-saved rows can't be selected — saving them again is a no-op, and
  // including them would make the selection count lie about what will change.
  const selectablePage = pageRows.filter(c => !savedPlaceIds.has(c.placeId))
  const selectableAll = shown.filter(c => !savedPlaceIds.has(c.placeId))
  const allPageSelected = selectablePage.length > 0 && selectablePage.every(c => selected.has(c.placeId))

  function toggle(placeId: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(placeId)) next.delete(placeId)
      else next.add(placeId)
      return next
    })
  }

  function togglePage() {
    setSelected(prev => {
      const next = new Set(prev)
      for (const c of selectablePage) {
        if (allPageSelected) next.delete(c.placeId)
        else next.add(c.placeId)
      }
      return next
    })
  }

  async function saveOne(candidate: ProspectCandidate) {
    setSavingOne(candidate.placeId)
    try {
      await api.prospecting.save(candidate, searched.category, searched.area, groupName.trim() || undefined)
      toast.success(`Saved ${candidate.name}`)
      mutate(PROSPECTS_KEY)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSavingOne(null)
    }
  }

  async function saveSelected() {
    const picked = candidates.filter(c => selected.has(c.placeId))
    if (!picked.length) return
    setSavingBulk(true)
    try {
      const res = await api.prospecting.saveMany(picked, searched.category, searched.area, groupName.trim() || undefined)
      toast.success(`Saved ${res.saved} to "${groupName.trim() || titleCase(searched.category)}"`)
      setSelected(new Set())
      mutate(PROSPECTS_KEY)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save selection')
    } finally {
      setSavingBulk(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Results ({shown.length}
          {shown.length !== candidates.length && <span className="font-normal text-muted-foreground"> of {candidates.length}</span>})
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {candidates.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
            {fromCache
              ? <span>Cached results from {new Date(fetchedAt).toLocaleString()} — no API call made.</span>
              : <span>Fresh search — {new Date(fetchedAt).toLocaleString()}.</span>}
            <button onClick={onRefresh} disabled={searching} className="ml-auto font-medium text-primary hover:underline disabled:opacity-50">
              {searching ? 'Refreshing…' : 'Force fresh search'}
            </button>
          </div>
        )}
        {candidates.length === 0 ? (
          <EmptyState icon={Search} title="No matches" description="Try a broader category, a different area, or relax the filters." />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-3">
              <Input
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder="Filter these results by name or address"
                className="h-8 w-64"
              />
              {savedCount > 0 && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={hideSaved} onChange={e => setHideSaved(e.target.checked)} className="accent-primary" />
                  Hide {savedCount} already saved
                </label>
              )}
              <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                Rows
                <select
                  value={pageSize}
                  onChange={e => setPageSize(Number(e.target.value))}
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                >
                  {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>

            {/* Selection bar — group name applies to whatever gets saved next,
                single or bulk, so it sits here rather than on each row. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
              <label className="flex items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={allPageSelected}
                  onChange={togglePage}
                  disabled={!selectablePage.length}
                  aria-label="Select all on this page"
                  className="accent-primary"
                />
                {selected.size ? `${selected.size} selected` : 'Select page'}
              </label>
              {selectableAll.length > selectablePage.length && (
                <button
                  onClick={() => setSelected(new Set(selectableAll.map(c => c.placeId)))}
                  className="text-primary hover:underline"
                >
                  Select all {selectableAll.length} matching
                </button>
              )}
              {selected.size > 0 && (
                <button onClick={() => setSelected(new Set())} className="text-muted-foreground hover:text-foreground">
                  Clear
                </button>
              )}
              <label className="ml-auto flex items-center gap-1.5 text-muted-foreground">
                Save to group
                <Input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="e.g. Roofers" className="h-8 w-40" />
              </label>
              <Button size="sm" onClick={saveSelected} disabled={!selected.size || savingBulk}>
                {savingBulk ? 'Saving…' : `Save ${selected.size || ''} selected`.trim()}
              </Button>
            </div>

            <div className="flex flex-col divide-y divide-border">
              {pageRows.map(c => {
                const alreadySaved = savedPlaceIds.has(c.placeId)
                return (
                  <div key={c.placeId} className="flex items-center gap-3 py-2.5 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.has(c.placeId)}
                      onChange={() => toggle(c.placeId)}
                      disabled={alreadySaved}
                      aria-label={`Select ${c.name}`}
                      className="accent-primary"
                    />
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
                    <Button variant={alreadySaved ? 'ghost' : 'outline'} size="sm" disabled={alreadySaved || savingOne === c.placeId} onClick={() => saveOne(c)}>
                      {alreadySaved ? 'Saved' : savingOne === c.placeId ? 'Saving…' : 'Save'}
                    </Button>
                  </div>
                )
              })}
              {!pageRows.length && (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  {hideSaved && savedCount ? 'Everything matching is already saved — untick “Hide already saved” to see them.' : 'Nothing matches that filter.'}
                </p>
              )}
            </div>

            {pageCount > 1 && (
              <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                <span>
                  {current * pageSize + 1}–{Math.min((current + 1) * pageSize, shown.length)} of {shown.length}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button variant="outline" size="sm" className="h-7 px-2" disabled={current === 0} onClick={() => setPage(current - 1)}>Prev</Button>
                  <span>Page {current + 1} of {pageCount}</span>
                  <Button variant="outline" size="sm" className="h-7 px-2" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ── Saved prospects, grouped ─────────────────────────────────────────────────
// One flat list of every business ever saved stops being usable a few searches
// in, so rows are bucketed by their group ("Roofers", "Med Spas") into
// collapsible sections that export independently.
function SavedProspects({ prospects }: { prospects: Prospect[] | undefined }) {
  const groups = useMemo(() => {
    const map = new Map<string, Prospect[]>()
    for (const p of prospects ?? []) {
      const key = p.groupName ?? NO_GROUP
      const bucket = map.get(key)
      if (bucket) bucket.push(p)
      else map.set(key, [p])
    }
    // Ungrouped last (NO_GROUP's leading space would otherwise sort it first).
    return [...map.entries()].sort(([a], [b]) => {
      if (a === NO_GROUP) return 1
      if (b === NO_GROUP) return -1
      return a.localeCompare(b)
    })
  }, [prospects])

  const groupNames = groups.map(([name]) => name).filter(n => n !== NO_GROUP)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Saved prospects ({prospects?.length ?? 0})</CardTitle>
        {!!prospects?.length && (
          <button onClick={() => downloadCsv()} className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm font-medium hover:bg-muted">
            <Download className="h-3.5 w-3.5" /> Export all
          </button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2 pt-0">
        {prospects?.length
          ? groups.map(([name, rows]) => (
            <GroupSection key={name} name={name} rows={rows} groupNames={groupNames} defaultOpen={groups.length === 1} />
          ))
          : <EmptyState icon={Target} title="No saved prospects yet" description="Search above and save the good ones to start building your outreach list." />}
      </CardContent>
    </Card>
  )
}

function GroupSection({ name, rows, groupNames, defaultOpen }: {
  name: string; rows: Prospect[]; groupNames: string[]; defaultOpen: boolean
}) {
  const ungrouped = name === NO_GROUP
  const label = ungrouped ? 'Ungrouped' : name
  const [open, setOpen] = useState(defaultOpen)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(label)

  // Renaming to a name that already exists merges the two groups — the
  // intended way to collapse "Roofer" and "Roofing" into one.
  async function rename() {
    const target = draft.trim()
    setRenaming(false)
    if (!target || target === name) return
    try {
      const res = await api.prospecting.renameGroup(name, target)
      mutate(PROSPECTS_KEY)
      toast.success(`Moved ${res.moved} to "${target}"`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to rename group')
    }
  }

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={() => setOpen(o => !o)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onClick={e => e.stopPropagation()}
              onBlur={rename}
              onKeyDown={e => { if (e.key === 'Enter') rename(); if (e.key === 'Escape') { setDraft(label); setRenaming(false) } }}
              className="h-6 w-48 border-b border-primary bg-transparent text-sm font-medium outline-none"
            />
          ) : (
            <span className="truncate text-sm font-medium">{label}</span>
          )}
          <Badge variant="outline" className="shrink-0">{rows.length}</Badge>
        </button>
        {!ungrouped && !renaming && (
          <button
            onClick={() => { setDraft(label); setRenaming(true) }}
            className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
          >
            Rename
          </button>
        )}
        <button
          onClick={() => downloadCsv(
            { group: ungrouped ? UNGROUPED_KEY : name },
            `prospects-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`,
          )}
          className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Download className="h-3 w-3" /> Export
        </button>
      </div>
      {open && (
        <div className="flex flex-col divide-y divide-border border-t border-border px-3">
          {rows.map(p => <ProspectRow key={p.id} prospect={p} groupNames={groupNames} />)}
        </div>
      )}
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
  // Single control for both "which library are we looking at" and "which
  // library do new uploads join" — these used to be two separate dropdowns
  // stacked on top of each other with no visual distinction, which read as
  // one control and caused real confusion (an operator set the upload target
  // to a library and reasonably expected the grid below to match it, while a
  // separate "Showing" filter silently kept displaying everything). One value
  // driving both removes the possibility of them disagreeing.
  // '' = unassigned, or a library id.
  const [uploadLibraryId, setUploadLibraryId] = useState('')
  const { data: references } = useSWR(
    [DESIGN_REFS_KEY, uploadLibraryId],
    () => api.prospecting.designReferences({ libraryId: uploadLibraryId || UNASSIGNED_LIBRARY })
  )
  const [uploading, setUploading] = useState(false)
  const [notes, setNotes] = useState('')

  async function uploadFiles(files: FileList | null) {
    if (!files?.length) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        await api.prospecting.uploadDesignReference(file, {
          libraryId: uploadLibraryId || undefined,
          notes: notes.trim() || undefined,
        })
      }
      mutate([DESIGN_REFS_KEY, uploadLibraryId])
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
      mutate([DESIGN_REFS_KEY, uploadLibraryId])
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
          <label className="text-xs text-muted-foreground whitespace-nowrap">Library:</label>
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

function ProspectRow({ prospect, groupNames }: { prospect: Prospect; groupNames: string[] }) {
  const [expanded, setExpanded] = useState(false)
  const [drafting, setDrafting] = useState(false)
  const [draftingValue, setDraftingValue] = useState(false)
  const [auditing, setAuditing] = useState(false)
  const [showRowAdvanced, setShowRowAdvanced] = useState(false)
  const [audit, setAudit] = useState<SeoCrawl | null>(null)
  const [email, setEmail] = useState(prospect.email ?? '')
  const [group, setGroup] = useState(prospect.groupName ?? '')
  // Same SWR key MockupPanel uses below, so this shares its cache rather than
  // firing a second request — just needs existence, not the full list detail.
  const { data: mockups } = useSWR(['prospect-mockups', prospect.id], () => api.prospecting.mockups(prospect.id))
  const hasMockup = !!mockups?.length

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

  // Fuller value-prop email — only useful once a mockup exists to reference,
  // so the button stays hidden until then rather than producing an email that
  // references a concept that doesn't exist yet.
  async function generateValueDraft() {
    setDraftingValue(true)
    try {
      await api.prospecting.generateValueDraft(prospect.id)
      toast.success('Value email generated')
      setExpanded(true)
      mutate(PROSPECTS_KEY)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate value email')
    } finally {
      setDraftingValue(false)
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

  // Free text rather than a fixed picker so one control both moves a prospect
  // into an existing group and creates a new one; the datalist below just
  // saves typing for the groups that already exist.
  async function saveGroup() {
    const next = group.trim()
    if (next === (prospect.groupName ?? '')) return
    try {
      await api.prospecting.update(prospect.id, { groupName: next || null })
      toast.success(next ? `Moved to "${next}"` : 'Removed from its group')
      mutate(PROSPECTS_KEY)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change group')
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
            {/* Short first-touch note, for a prospect with no concept yet —
                the only email worth generating before there's work to show.
                Once a concept exists, "Generate email" in the concept panel
                below is the one to use: it audits, links, and writes in one
                step. The pieces of that flow stay reachable under Advanced
                for running a single part on its own. */}
            <Button variant="outline" size="sm" onClick={generateDrafts} disabled={drafting}>
              <Sparkles className="h-3.5 w-3.5" />{drafting ? 'Drafting…' : prospect.draftPlain ? 'Regenerate drafts' : 'Generate drafts'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowRowAdvanced(v => !v)}>
              <FlaskConical className="h-3.5 w-3.5" />{showRowAdvanced ? 'Hide advanced' : 'Advanced'}
            </Button>
            {showRowAdvanced && hasMockup && (
              <Button variant="outline" size="sm" onClick={generateValueDraft} disabled={draftingValue} title="Just the value email, using whatever preview link already exists and no audit findings — the full one-click version is in the concept panel below">
                <Sparkles className="h-3.5 w-3.5" />{draftingValue ? 'Drafting…' : prospect.draftValue ? 'Regenerate value email' : 'Value email only'}
              </Button>
            )}
            {showRowAdvanced && prospect.website && (
              <Button variant="outline" size="sm" onClick={runAudit} disabled={auditing}>
                <Search className="h-3.5 w-3.5" />{auditing ? 'Auditing…' : 'Audit site only'}
              </Button>
            )}
            <div className="flex items-center gap-1.5">
              <Input value={email} onChange={e => setEmail(e.target.value)} onBlur={saveEmail} placeholder="email (manual)" className="h-8 w-52" />
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                value={group}
                onChange={e => setGroup(e.target.value)}
                onBlur={saveGroup}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                list={`groups-${prospect.id}`}
                placeholder="group"
                className="h-8 w-40"
              />
              <datalist id={`groups-${prospect.id}`}>
                {groupNames.map(n => <option key={n} value={n} />)}
              </datalist>
            </div>
          </div>

          {(prospect.draftPlain || prospect.draftLoom) && (
            <div className="grid gap-3 lg:grid-cols-2">
              {prospect.draftPlain && <DraftBox label="Plain email" text={prospect.draftPlain} />}
              {prospect.draftLoom && <DraftBox label="With Loom video" text={prospect.draftLoom} />}
            </div>
          )}

          {prospect.draftValue && <DraftBox label="Value email (mockup + audit + chat assistant + book-a-call)" text={prospect.draftValue} />}

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

// Live view of a generation run: which step is happening, roughly how far in,
// what it has cost so far. Cost is shown as it accrues rather than only at the
// end, so a run that dies halfway still says what it spent.
// `labels` exists because this panel now drives two different jobs (the
// concept, and the outreach email) and "Generating…" would be wrong for one
// of them. Defaults keep the concept's original wording verbatim.
interface RunLabels { running: string; done: string; failed: string }
const CONCEPT_LABELS: RunLabels = { running: 'Generating', done: 'Generation complete', failed: 'Generation failed' }

function GenerationRunPanel({ run, labels = CONCEPT_LABELS }: { run: GenerationRun; labels?: RunLabels }) {
  const [showCost, setShowCost] = useState(false)
  const done = run.steps.filter((s: RunStep) => s.status === 'done' || s.status === 'skipped').length
  const overall = Math.round((done / Math.max(1, run.steps.length)) * 100)

  const tone =
    run.status === 'error' ? 'border-destructive/50 bg-destructive/5'
    : run.status === 'done' ? 'border-emerald-500/40 bg-emerald-500/5'
    : 'border-primary/40 bg-primary/5'

  return (
    <div className={`flex flex-col gap-2 rounded-md border border-dashed p-3 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <Sparkles className="h-3.5 w-3.5" />
          {run.status === 'running' ? `${labels.running} — ${overall}%`
            : run.status === 'done' ? labels.done
            : labels.failed}
        </span>
        <button
          onClick={() => setShowCost(v => !v)}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          title="What this run cost, per provider call"
        >
          {formatCost(run.costMicros)}{run.status === 'running' ? ' so far' : ''}
        </button>
      </div>

      <div className="flex flex-col gap-1">
        {run.steps.map((step: RunStep) => (
          <div key={step.key} className="flex items-center gap-2 text-xs">
            <span className="w-4 shrink-0 text-center">
              {step.status === 'done' ? <Check className="h-3 w-3 text-emerald-500" />
                : step.status === 'error' ? <X className="h-3 w-3 text-destructive" />
                : step.status === 'skipped' ? <span className="text-muted-foreground">–</span>
                : step.status === 'running' ? <Loader2 className="h-3 w-3 animate-spin text-primary" />
                : <span className="text-muted-foreground/40">○</span>}
            </span>
            <span className={`w-44 shrink-0 ${step.status === 'pending' ? 'text-muted-foreground/60' : ''}`}>
              {step.label}
            </span>
            {/* Only the running step gets a bar — a finished step's bar carries
                no information and just adds visual noise to the list. */}
            {step.status === 'running' && (
              <span className="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-border">
                <span className="block h-full bg-primary transition-all duration-500" style={{ width: `${step.pct}%` }} />
              </span>
            )}
            {step.detail && <span className="truncate text-muted-foreground">{step.detail}</span>}
          </div>
        ))}
      </div>

      {run.error && <p className="text-xs text-destructive">{run.error}</p>}

      {showCost && (
        <div className="flex flex-col gap-0.5 border-t border-border pt-2 text-xs text-muted-foreground">
          {run.costDetail.length === 0 && <span>Nothing billed yet.</span>}
          {run.costDetail.map((c: CostItem, i: number) => (
            <div key={i} className="flex justify-between gap-3">
              <span className="truncate">
                {c.step} · {c.model} · {c.kind === 'image' ? `${c.qty} image` : `${c.qty.toLocaleString()} tokens`}
              </span>
              <span className="shrink-0 tabular-nums">{formatCost(c.micros)}</span>
            </div>
          ))}
          {run.costDetail.length > 0 && (
            <div className="mt-1 flex justify-between gap-3 border-t border-border pt-1 font-medium text-foreground">
              <span>Total</span><span className="tabular-nums">{formatCost(run.costMicros)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Alignment problems the audit measured in a real browser. Advisory only — the
// concept HTML is never rewritten from these, so this is a "look at this",
// not a record of something that was changed.
function LayoutFindingsPanel({ findings }: { findings: LayoutFinding[] }) {
  // The same defect shows up at several viewport widths; collapse to one row
  // per element so four widths of the same problem read as one problem.
  const byLabel = new Map<string, LayoutFinding>()
  for (const f of findings) if (!byLabel.has(f.label)) byLabel.set(f.label, f)

  return (
    <div className="flex flex-col gap-1 rounded-md border border-dashed border-amber-500/40 bg-amber-500/5 p-3 text-xs">
      <span className="flex items-center gap-1.5 font-medium text-amber-500">
        <FlaskConical className="h-3.5 w-3.5" />
        {byLabel.size} alignment issue{byLabel.size === 1 ? '' : 's'} — not auto-corrected
      </span>
      {[...byLabel.values()].map((f, i) => (
        <span key={i} className="text-muted-foreground">
          {f.kind === 'nav-centring' ? 'Nav links' : `"${f.label}"`} off by {f.delta > 0 ? '+' : ''}{f.delta}px
          {f.kind === 'nav-centring' ? ' horizontally' : ' vertically'} at {f.viewport}px wide
        </span>
      ))}
    </div>
  )
}

// The layout-first draft, shown collapsed under the concept it produced so the
// operator can tell whether a weak result came from a bad drawn layout or from
// a bad translation of a good one. Collapsed by default: it's a working
// artifact with deliberately unreliable text, not something to read.
function LayoutDraft({ mockupId }: { mockupId: string }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let objectUrl: string | null = null
    let cancelled = false
    api.prospecting.mockupLayoutImageUrl(mockupId)
      .then(u => {
        if (cancelled) { URL.revokeObjectURL(u); return }
        objectUrl = u
        setUrl(u)
      })
      .catch(() => {})
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setUrl(null)
    }
  }, [mockupId, open])

  return (
    <div className="flex flex-col gap-2">
      <Button variant="ghost" size="sm" className="self-start" onClick={() => setOpen(o => !o)}>
        <ImageIcon className="h-3.5 w-3.5" />
        {open ? 'Hide drawn layout' : 'Show drawn layout'}
      </Button>
      {open && (url
        ? <img src={url} alt="Drawn layout draft this concept was built from" className="w-full max-w-md rounded-md border border-border" />
        : <div className="h-48 w-full max-w-md animate-pulse rounded-md bg-muted" />)}
    </div>
  )
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
  const [generatingLayoutFirst, setGeneratingLayoutFirst] = useState(false)
  // Orthogonal to layout-first — applies to whichever generate button is used,
  // so it's a checkbox rather than a third button.
  const [aiPhotos, setAiPhotos] = useState(true)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [linking, setLinking] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [promptPreview, setPromptPreview] = useState<MockupPreview | null>(null)
  // Real AI-generated PNG path — shares every control above (brand, style
  // notes, library, primary reference) with the HTML path; only the terminal
  // generation call differs.
  const [generatingImage, setGeneratingImage] = useState(false)
  const [previewingImage, setPreviewingImage] = useState(false)
  // Scraped once the operator asks (not automatically — a Playwright render
  // per expanded row would be wasteful). Holds the FULL editable brand, so
  // it's sent as-is as brandOverride once populated: buildGenerationContext
  // on the API side shallow-merges it over its own scrape either way, so
  // sending the complete edited object is equivalent to sending just the
  // diff and much simpler to keep in sync with the form.
  const [brand, setBrand] = useState<ExtractedBrand | null>(null)
  const [scrapingBrand, setScrapingBrand] = useState(false)
  // Populated by the (paid, cheap-tier) "Analyze design" step — a corrected
  // services list plus concrete style direction derived from actually looking
  // at the references and current site, rather than the blind regex scrape.
  // Editable like brand, and sent as-is to both preview and real generation.
  const [styleNotes, setStyleNotes] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  // Which single reference the concept should follow structurally. '' = treat
  // all references as equal weight, which reliably averages them into a
  // generic layout — naming one gives the model a layout to actually copy.
  const [primaryReferenceId, setPrimaryReferenceId] = useState('')
  // Thumbnails for the picker, scoped to the chosen library so the options
  // match exactly what a generation would send.
  const { data: libraryRefs } = useSWR(
    ['mockup-refs', libraryId],
    // libraryId || undefined would send NO filter (every library's
    // references) rather than the unassigned pool a real generation actually
    // uses when no library is chosen — this picker must match that exactly,
    // or an operator can pin a "primary reference" that generation silently
    // ignores because it isn't in the pool that gets sent.
    () => api.prospecting.designReferences({ libraryId: libraryId || UNASSIGNED_LIBRARY })
  )

  // A reference pinned from a different library isn't in the sent set, so the
  // server would silently ignore it — clear rather than leave a stale pick.
  useEffect(() => {
    if (primaryReferenceId && libraryRefs && !libraryRefs.some(r => r.id === primaryReferenceId)) {
      setPrimaryReferenceId('')
    }
  }, [libraryRefs, primaryReferenceId])

  async function scrapeBrand() {
    setScrapingBrand(true)
    try {
      setBrand(await api.prospecting.scrapeBrand(prospect.id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to scrape brand')
    } finally {
      setScrapingBrand(false)
    }
  }

  async function analyzeDesign() {
    setAnalyzing(true)
    try {
      const result = await api.prospecting.analyzeDesign(prospect.id, {
        libraryId: libraryId || null, primaryReferenceId: primaryReferenceId || null,
        brandOverride: brand ?? undefined,
      })
      setStyleNotes(result.styleNotes)
      // Only overwrite services if the analysis actually found some — an
      // empty/failed analysis shouldn't wipe out a scrape (or a manual edit)
      // that was already good.
      if (result.services.length) {
        setBrand(prev => prev ? { ...prev, services: result.services } : prev)
      }
      toast.success('Design analyzed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to analyze design')
    } finally {
      setAnalyzing(false)
    }
  }

  useEffect(() => {
    if (libraryTouched || !libraries?.length || !prospect.category) return
    // Raw substring containment misses same-root word-form mismatches —
    // "roofer" vs "Roofing" share the root "roof" but neither is a substring
    // of the other, so a plain .includes() silently matched nothing and this
    // quietly fell back to "no library" (zero reference images sent). Strip
    // common suffixes before comparing so same-root categories still match.
    const stem = (s: string) => s.toLowerCase().trim().replace(/(ing|ers|er|s|es)$/, '')
    const category = stem(prospect.category)
    const match = libraries.find(lib => {
      const name = stem(lib.name)
      return category.includes(name) || name.includes(category)
    })
    if (match) setLibraryId(match.id)
  }, [libraries, prospect.category, libraryTouched])

  // Reattaches to whatever run exists for this prospect, so refreshing the page
  // mid-generation shows the job still running rather than an idle panel.
  const { data: initialRun } = useSWR(`prospect-latest-run-${prospect.id}`, () => api.prospecting.latestRun(prospect.id))
  useEffect(() => {
    if (initialRun?.status === 'running' && !runId) setRunId(initialRun.id)
  }, [initialRun, runId])

  const activeRunId = runId ?? initialRun?.id ?? null
  // Polls only while the run is live; once it settles SWR stops and the final
  // state (cost, findings, any error) stays on screen.
  const { data: run } = useSWR(
    activeRunId ? `prospect-run-${activeRunId}` : null,
    () => api.prospecting.getRun(activeRunId as string),
    { refreshInterval: d => (d?.status === 'running' ? 1500 : 0), fallbackData: initialRun ?? undefined }
  )

  // A finished run means there's a new concept to show.
  const runStatus = run?.status
  useEffect(() => {
    if (runStatus === 'done') mutate(mockupsKey)
    if (runStatus === 'error' && run?.error) toast.error(run.error)
  }, [runStatus, run?.error, mockupsKey])

  // ── The outreach email, same run/poll contract as the concept above ───────
  const [emailRunId, setEmailRunId] = useState<string | null>(null)
  const [startingEmail, setStartingEmail] = useState(false)
  const { data: initialEmailRun } = useSWR(
    `prospect-latest-email-run-${prospect.id}`,
    () => api.prospecting.latestRun(prospect.id, 'email')
  )
  useEffect(() => {
    if (initialEmailRun?.status === 'running' && !emailRunId) setEmailRunId(initialEmailRun.id)
  }, [initialEmailRun, emailRunId])
  const activeEmailRunId = emailRunId ?? initialEmailRun?.id ?? null
  const { data: emailRun } = useSWR(
    activeEmailRunId ? `prospect-email-run-${activeEmailRunId}` : null,
    () => api.prospecting.getRun(activeEmailRunId as string),
    { refreshInterval: d => (d?.status === 'running' ? 1500 : 0), fallbackData: initialEmailRun ?? undefined }
  )
  const emailRunStatus = emailRun?.status
  useEffect(() => {
    // The draft lands on the prospect row itself, so that's what needs
    // refetching — the email never touches the mockups list.
    if (emailRunStatus === 'done') { mutate(PROSPECTS_KEY); toast.success('Email draft ready') }
    if (emailRunStatus === 'error' && emailRun?.error) toast.error(emailRun.error)
  }, [emailRunStatus, emailRun?.error])

  const latest: ProspectMockup | undefined = mockups?.[0]
  // Regenerating has always inserted a new row rather than overwriting (see
  // prospect-mockups.ts) — every past concept was already sitting in the DB,
  // just invisible, since this panel only ever rendered mockups[0]. This
  // shows the 3 most recent as tabs so a regenerate doesn't feel like it
  // destroyed the previous attempt. Nothing is deleted; older-than-3 concepts
  // still exist and are reachable via a preview link if one was made.
  const recentMockups = mockups?.slice(0, 3) ?? []
  const [selectedMockupId, setSelectedMockupId] = useState<string | null>(null)
  const [deletingMockupId, setDeletingMockupId] = useState<string | null>(null)
  const confirm = useConfirm()
  // A finished run just produced a new mockup — follow it rather than leaving
  // the operator looking at whatever tab they'd previously selected.
  useEffect(() => {
    if (runStatus === 'done') setSelectedMockupId(null)
  }, [runStatus])
  const selected: ProspectMockup | undefined =
    (selectedMockupId && recentMockups.find(m => m.id === selectedMockupId)) || latest
  const activePreview: ProspectPreview | undefined = previews?.find(p => !p.revokedAt)

  // layoutFirst adds an image generation ahead of the Claude call: a full-page
  // design drawn for THIS business becomes the layout spec for the HTML,
  // rather than Claude averaging the generic library references. Costs more
  // and takes roughly twice as long, so it's a separate button.
  async function generate(layoutFirst = false) {
    const setBusy = layoutFirst ? setGeneratingLayoutFirst : setGenerating
    setBusy(true)
    try {
      await api.prospecting.generateMockup(prospect.id, {
        directionNotes: notes.trim() || undefined, styleNotes: styleNotes.trim() || undefined,
        libraryId: libraryId || null, primaryReferenceId: primaryReferenceId || null,
        brandOverride: brand ?? undefined,
        layoutFirst,
        aiPhotos,
      })
      mutate(mockupsKey)
      toast.success('Concept generated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate concept')
    } finally {
      setBusy(false)
    }
  }

  // No Claude call — assembles the same prompt + images generateMockup would
  // send and stops there, so this costs zero tokens. Paste the result into a
  // free tool (ChatGPT, Gemini) to sanity-check the design library before
  // spending real generations.
  async function previewPrompt() {
    setPreviewing(true)
    try {
      setPromptPreview(await api.prospecting.previewMockup(prospect.id, {
        directionNotes: notes.trim() || undefined, styleNotes: styleNotes.trim() || undefined,
        libraryId: libraryId || null, primaryReferenceId: primaryReferenceId || null,
        brandOverride: brand ?? undefined,
      }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to build preview')
    } finally {
      setPreviewing(false)
    }
  }

  // Real AI-generated PNG — costs money whether it's good or not, more so
  // than the HTML path, so the free preview below matters even more here.
  async function generateImage() {
    setGeneratingImage(true)
    try {
      await api.prospecting.generateImageMockup(prospect.id, {
        directionNotes: notes.trim() || undefined, styleNotes: styleNotes.trim() || undefined,
        libraryId: libraryId || null, primaryReferenceId: primaryReferenceId || null,
        brandOverride: brand ?? undefined,
      })
      mutate(mockupsKey)
      toast.success('Image concept generated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate image concept')
    } finally {
      setGeneratingImage(false)
    }
  }

  async function previewImagePrompt() {
    setPreviewingImage(true)
    try {
      setPromptPreview(await api.prospecting.previewImageMockup(prospect.id, {
        directionNotes: notes.trim() || undefined, styleNotes: styleNotes.trim() || undefined,
        libraryId: libraryId || null, primaryReferenceId: primaryReferenceId || null,
        brandOverride: brand ?? undefined,
      }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to build image preview')
    } finally {
      setPreviewingImage(false)
    }
  }

  // Fires the wizard and hands back a run id to poll. The job itself keeps
  // going on the API regardless of what this tab does next.
  async function startGeneration() {
    setStarting(true)
    try {
      const started = await api.prospecting.startGeneration(prospect.id, {
        libraryId: libraryId || null,
        primaryReferenceId: primaryReferenceId || null,
        directionNotes: notes.trim() || undefined,
        brandOverride: brand ?? undefined,
        aiPhotos,
        layoutFirst: true,
      })
      setRunId(started.id)
      mutate(`prospect-latest-run-${prospect.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start generation')
    } finally {
      setStarting(false)
    }
  }

  // Passes the concept the operator is actually looking at, not the newest —
  // they pick a favourite from the tabs and the email must pitch that one.
  async function startEmail() {
    setStartingEmail(true)
    try {
      const started = await api.prospecting.startEmail(prospect.id, { mockupId: selected?.id ?? null })
      setEmailRunId(started.id)
      mutate(`prospect-latest-email-run-${prospect.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start email generation')
    } finally {
      setStartingEmail(false)
    }
  }

  async function removeMockup(mockupId: string) {
    const ok = await confirm({
      title: 'Delete concept',
      message: 'Delete this concept? The generated page and its images are removed for good.',
      confirmLabel: 'Delete concept',
    })
    if (!ok) return
    setDeletingMockupId(mockupId)
    try {
      await api.prospecting.deleteMockup(mockupId)
      // Drop the selection if it pointed at the deleted one, so the panel
      // falls back to the newest rather than rendering a stale concept.
      setSelectedMockupId(id => (id === mockupId ? null : id))
      await mutate(mockupsKey)
      toast.success('Concept deleted')
    } catch (err) {
      // The API refuses while a live preview link points at it; that message
      // is the actionable part, so show it rather than a generic failure.
      toast.error(err instanceof Error ? err.message : 'Failed to delete concept')
    } finally {
      setDeletingMockupId(null)
    }
  }

  async function createLink() {
    if (!selected) return
    setLinking(true)
    try {
      await api.prospecting.createPreview(prospect.id, { mockupId: selected.id, crawlId: latestCrawlId })
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

  const busy = starting || run?.status === 'running'
  const emailBusy = startingEmail || emailRun?.status === 'running'

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      {/* One button does the whole job. Everything that used to sit out here
          moved behind Advanced — those steps are all still reachable, they just
          aren't the thing you look at every day. */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={startGeneration} disabled={busy}>
          <Sparkles className="h-3.5 w-3.5" />
          {busy ? 'Generating…' : latest ? 'Regenerate concept' : 'Generate concept'}
        </Button>
        {/* The whole outreach step in one button: it makes the shareable link
            for the concept on screen, audits their site, and writes the email
            from both. Replaces having to know that "Audit site" fed nothing
            into "Generate value email". */}
        {selected && (
          <Button size="sm" onClick={startEmail} disabled={emailBusy} title="Links this concept, audits their current site, and writes the outreach email using both">
            <Mail className="h-3.5 w-3.5" />
            {emailBusy ? 'Preparing…' : prospect.draftValue ? 'Regenerate email' : 'Generate email'}
          </Button>
        )}
        {selected && (
          <Button variant="outline" size="sm" onClick={createLink} disabled={linking}>
            <Link2 className="h-3.5 w-3.5" />{linking ? 'Creating…' : 'Create preview link'}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setShowAdvanced(v => !v)}>
          <FlaskConical className="h-3.5 w-3.5" />{showAdvanced ? 'Hide advanced' : 'Advanced'}
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

      {run && <GenerationRunPanel run={run} />}
      {emailRun && (
        <GenerationRunPanel
          run={emailRun}
          labels={{ running: 'Preparing email', done: 'Email draft ready', failed: 'Email generation failed' }}
        />
      )}

      {showAdvanced && (
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-2">
        <span className="w-full text-xs text-muted-foreground">
          Individual steps — the button above runs all of these in order. Use these to redo one
          stage without paying for the rest.
        </span>
        <label
          className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
          title="Generates clean stock-style photography instead of reusing the business's own photos — useful when their real images are low-quality, badly cropped, or have text burned into them. Costs two extra image generations."
        >
          <input
            type="checkbox"
            checked={aiPhotos}
            onChange={e => setAiPhotos(e.target.checked)}
            disabled={busy}
            className="h-3.5 w-3.5 accent-primary"
          />
          AI photos
        </label>
        <Button variant="outline" size="sm" onClick={scrapeBrand} disabled={scrapingBrand}>
          <Wand2 className="h-3.5 w-3.5" />
          {scrapingBrand ? 'Scraping…' : brand ? 'Re-scrape brand' : 'Scrape brand'}
        </Button>
        <Button variant="outline" size="sm" onClick={analyzeDesign} disabled={analyzing} title="Costs a small, cheap-tier Claude call — looks at the references and current site to correct services and suggest concrete style direction">
          <Sparkles className="h-3.5 w-3.5" />
          {analyzing ? 'Analyzing…' : styleNotes ? 'Re-analyze design' : 'Analyze design'}
        </Button>
        <Button variant="outline" size="sm" onClick={() => generate()} disabled={generating || generatingLayoutFirst}>
          <ImageIcon className="h-3.5 w-3.5" />
          {generating ? 'Generating…' : latest ? 'Regenerate concept' : 'Generate concept'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => generate(true)}
          disabled={generating || generatingLayoutFirst}
          title="Draws a full-page design image for this business first, then builds the HTML to match it — copy and colours still come from the scraped brand, not the image. Costs an image generation on top of the Claude call and takes about twice as long."
        >
          <Sparkles className="h-3.5 w-3.5" />
          {generatingLayoutFirst ? 'Drawing layout…' : 'Concept from drawn layout'}
        </Button>
        <label
          className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground"
          title="Generates clean stock-style photography instead of reusing the business's own photos — useful when their real images are low-quality, badly cropped, or have text burned into them. Costs two extra image generations. Applies to either generate button."
        >
          <input
            type="checkbox"
            checked={aiPhotos}
            onChange={e => setAiPhotos(e.target.checked)}
            disabled={generating || generatingLayoutFirst}
            className="h-3.5 w-3.5 accent-primary"
          />
          AI photos
        </label>
        <Button variant="ghost" size="sm" onClick={previewPrompt} disabled={previewing}>
          <FlaskConical className="h-3.5 w-3.5" />{previewing ? 'Building…' : 'Preview prompt (free)'}
        </Button>
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
        <Button variant="outline" size="sm" onClick={generateImage} disabled={generatingImage} title="A real AI-generated PNG image, using the same brand/reference controls — costs an image generation regardless of the result">
          <ImageIcon className="h-3.5 w-3.5" />
          {generatingImage ? 'Generating…' : 'Generate image concept'}
        </Button>
        <Button variant="ghost" size="sm" onClick={previewImagePrompt} disabled={previewingImage}>
          <FlaskConical className="h-3.5 w-3.5" />{previewingImage ? 'Building…' : 'Preview image prompt (free)'}
        </Button>
      </div>
      )}

      {/* Four references of equal weight get averaged into a generic middle.
          Pinning one as the layout to follow is the single biggest lever on
          "why doesn't this look like my inspo". */}
      {!!libraryRefs?.length && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            Primary reference — the layout this concept should follow closely. The rest stay as
            secondary style influence. Leave unset to blend them all (usually more generic).
          </span>
          <div className="flex flex-wrap gap-1.5">
            {libraryRefs.map(ref => (
              <button
                key={ref.id}
                onClick={() => setPrimaryReferenceId(primaryReferenceId === ref.id ? '' : ref.id)}
                title={ref.label}
                className={`overflow-hidden rounded border-2 transition-colors ${
                  primaryReferenceId === ref.id ? 'border-primary' : 'border-transparent hover:border-border'
                }`}
              >
                <ReferenceThumb referenceId={ref.id} label={ref.label} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* "No library" silently means zero reference images get sent — easy to
          land on by accident (auto-match failing, or a remount resetting the
          picker) and easy to miss, so it's called out rather than left quiet. */}
      {!libraryId && (
        <p className="flex items-center gap-1.5 text-xs text-amber-500">
          <FlaskConical className="h-3 w-3" />
          No library selected — the concept will use only the unassigned reference pool (may be empty).
          Pick a library above to actually imitate its design references.
        </p>
      )}

      {brand && <BrandReviewPanel brand={brand} onChange={setBrand} />}

      {styleNotes && (
        <label className="flex flex-col gap-1 rounded-md border border-dashed border-primary/40 bg-primary/5 p-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium text-primary"><Sparkles className="h-3.5 w-3.5" /> Style direction from analysis — edit freely, sent as authoritative art direction</span>
          <textarea
            value={styleNotes}
            onChange={e => setStyleNotes(e.target.value)}
            className="h-24 w-full rounded-md border border-input bg-background p-2 text-xs text-foreground"
          />
        </label>
      )}

      {promptPreview && <PromptPreviewPanel preview={promptPreview} onClose={() => setPromptPreview(null)} />}

      {recentMockups.length > 1 && (
        <div className="flex items-center gap-1 border-b border-border pb-1">
          {recentMockups.map((m, i) => (
            <span
              key={m.id}
              className={`group flex items-center rounded-md ${
                selected?.id === m.id ? 'bg-primary/10' : 'hover:bg-muted/50'
              }`}
            >
              <button
                onClick={() => setSelectedMockupId(m.id)}
                className={`py-1 pl-2 text-xs ${
                  selected?.id === m.id ? 'font-medium text-primary' : 'text-muted-foreground group-hover:text-foreground'
                }`}
              >
                {i === 0 ? 'Latest' : `${new Date(m.createdAt).toLocaleDateString()} ${new Date(m.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`}
              </button>
              <button
                onClick={() => removeMockup(m.id)}
                disabled={deletingMockupId === m.id}
                title="Delete this concept"
                className="px-1.5 py-1 text-muted-foreground/50 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 disabled:opacity-40"
              >
                {deletingMockupId === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
              </button>
            </span>
          ))}
        </div>
      )}

      {selected && (selected.format === 'html' ? <ConceptPreview mockup={selected} /> : <MockupImage mockupId={selected.id} />)}
      {!!selected?.layoutFindings?.length && <LayoutFindingsPanel findings={selected.layoutFindings} />}
      {selected?.layoutImagePath && <LayoutDraft mockupId={selected.id} />}
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

// Reference images need the auth header, so they can't be a plain <img src> —
// same object-URL-and-revoke pattern as DesignReferenceCard above.
function ReferenceThumb({ referenceId, label }: { referenceId: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    api.prospecting.designReferenceImageUrl(referenceId)
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
  }, [referenceId])

  if (!url) return <div className="h-14 w-20 animate-pulse bg-muted" />
  return <img src={url} alt={label} className="h-14 w-20 object-cover" />
}

// What the API scraped from the prospect's live site — colors from computed
// styles, logo from a real <img> match, name/services/phone from a lighter
// regex pass — shown editable so a bad scrape (wrong colors, missed logo, a
// fabricated-looking service) gets caught and fixed before a generation is
// spent on it. Whatever's here is sent whole as `brandOverride`, so editing a
// field is exactly like fixing it before rather than after generating.
function BrandReviewPanel({ brand, onChange }: { brand: ExtractedBrand; onChange: (next: ExtractedBrand) => void }) {
  const [newColor, setNewColor] = useState('#')
  const [newService, setNewService] = useState('')
  const [newCertification, setNewCertification] = useState('')

  function set<K extends keyof ExtractedBrand>(key: K, value: ExtractedBrand[K]) {
    onChange({ ...brand, [key]: value })
  }

  function addColor() {
    const hex = newColor.trim()
    if (!/^#[0-9a-fA-F]{3,8}$/.test(hex)) { toast.error('Enter a valid hex color, e.g. #2563eb'); return }
    set('colors', [...brand.colors, hex])
    setNewColor('#')
  }

  function addService() {
    const s = newService.trim()
    if (!s) return
    set('services', [...brand.services, s])
    setNewService('')
  }

  function addCertification() {
    const c = newCertification.trim()
    if (!c) return
    set('certifications', [...brand.certifications, c])
    setNewCertification('')
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-dashed border-primary/40 bg-primary/5 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
        <Wand2 className="h-3.5 w-3.5" /> Scraped brand — edit anything before generating
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Business name
          <Input value={brand.businessName ?? ''} onChange={e => set('businessName', e.target.value || null)} className="h-8" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Phone shown on the concept
          <Input value={brand.phone ?? ''} onChange={e => set('phone', e.target.value || null)} className="h-8" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          License number (shown verbatim if set — leave blank if unsure)
          <Input value={brand.license ?? ''} onChange={e => set('license', e.target.value || null)} className="h-8" />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Tagline (tone reference only — not printed verbatim)
        <Input value={brand.headline ?? ''} onChange={e => set('headline', e.target.value || null)} className="h-8" />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Services — used ONLY as listed here, nothing is invented beyond this list</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {brand.services.map((s, i) => (
            <span key={i} className="flex items-center gap-1 rounded-full border border-border py-0.5 pl-2.5 pr-1 text-xs">
              {s}
              <button onClick={() => set('services', brand.services.filter((_, j) => j !== i))} aria-label={`Remove ${s}`} className="rounded-full p-0.5 text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Input
            value={newService}
            onChange={e => setNewService(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addService() }}
            placeholder="Add a service, press Enter"
            className="h-7 w-48 text-xs"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Certifications/trust badges — shown as text only, never as a fabricated logo</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {brand.certifications.map((c, i) => (
            <span key={i} className="flex items-center gap-1 rounded-full border border-border py-0.5 pl-2.5 pr-1 text-xs">
              {c}
              <button onClick={() => set('certifications', brand.certifications.filter((_, j) => j !== i))} aria-label={`Remove ${c}`} className="rounded-full p-0.5 text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Input
            value={newCertification}
            onChange={e => setNewCertification(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addCertification() }}
            placeholder="e.g. BBB Accredited — press Enter"
            className="h-7 w-56 text-xs"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Brand colors — pin exact hex codes if you know them</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {brand.colors.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5 rounded-full border border-border py-0.5 pl-1 pr-1 text-xs">
              <span className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: c }} />
              {c}
              <button onClick={() => set('colors', brand.colors.filter((_, j) => j !== i))} aria-label={`Remove ${c}`} className="rounded-full p-0.5 text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <Input
            value={newColor}
            onChange={e => setNewColor(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addColor() }}
            placeholder="#2563eb"
            className="h-7 w-24 text-xs font-mono"
          />
          <Button variant="outline" size="sm" onClick={addColor} className="h-7 px-2 text-xs"><Plus className="h-3 w-3" /> Add</Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {brand.logoUrl
          ? <img src={brand.logoUrl} alt="Detected logo" className="h-10 max-w-[8rem] rounded border border-border bg-background object-contain p-1" onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
          : <span className="text-xs text-muted-foreground">No logo — business name will be used as the wordmark.</span>}
        <Input
          value={brand.logoUrl ?? ''}
          onChange={e => set('logoUrl', e.target.value || null)}
          placeholder="Logo image URL"
          className="h-8 flex-1"
        />
        {brand.logoUrl && (
          <Button variant="ghost" size="sm" onClick={() => set('logoUrl', null)} className="h-8 px-2 text-xs">Clear</Button>
        )}
      </div>

      {brand.photoUrls.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            Real photos found on their site — the concept will reuse these instead of only CSS gradients
          </span>
          <div className="flex flex-wrap gap-1.5">
            {brand.photoUrls.map((url, i) => (
              <div key={i} className="group relative">
                <img src={url} alt="" className="h-14 w-20 rounded border border-border object-cover" onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
                <button
                  onClick={() => set('photoUrls', brand.photoUrls.filter((_, j) => j !== i))}
                  aria-label="Remove photo"
                  className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {brand.partnerLogoUrls.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            Partner/supplier logos found on their site — shown as a small trust strip, not hero/service imagery
          </span>
          <div className="flex flex-wrap gap-1.5">
            {brand.partnerLogoUrls.map((url, i) => (
              <div key={i} className="group relative">
                <img src={url} alt="" className="h-12 w-20 rounded border border-border bg-background object-contain p-1" onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
                <button
                  onClick={() => set('partnerLogoUrls', brand.partnerLogoUrls.filter((_, j) => j !== i))}
                  aria-label="Remove partner logo"
                  className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
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
