import { useRef, useState } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { Bot, MessageSquare, Sparkles, Upload, FileText, LifeBuoy, Trash2, RefreshCw, Code2, Copy, Plus, RotateCcw, ShieldCheck } from 'lucide-react'
import type { KnowledgeDoc, KnowledgeFile } from '@/lib/api'
import type { Client, WidgetConfig } from '@agent-platform/shared'
import { api } from '@/lib/api'
import { useClientCtx } from '@/pages/client/ClientLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Label } from '@/components/ui/input'
import { StatTile } from '@/components/stat-tile'
import { EmptyState } from '@/components/empty-state'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { KnowledgeFilePreview } from '@/components/attachment-preview'

function AssistantCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Bot className="h-4 w-4 text-primary" /> Your chat assistant</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0 text-sm text-muted-foreground">
        <p>
          This is the AI assistant embedded on your website. It answers visitor
          questions from your knowledge base, captures leads, and hands off
          to a human whenever it can't help or a visitor asks for one.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex items-start gap-2">
            <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span><strong className="text-foreground">Answers FAQs</strong> — grounded only in the documents you add.</span>
          </div>
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span><strong className="text-foreground">Captures leads</strong> — logs name, email, and intent under Leads.</span>
          </div>
          <div className="flex items-start gap-2">
            <LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span><strong className="text-foreground">Escalates to you</strong> — via Slack/email when it can't help.</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function OverviewTab({ clientId }: { clientId: string }) {
  const { data: stats } = useSWR(['stats', clientId], () => api.clients.stats(clientId))

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatTile label="Messages this week" value={stats?.messagesThisWeek ?? '—'} />
      <StatTile label="Questions answered" value={stats?.questionsAnswered ?? '—'} />
      <StatTile label="Time saved" value={stats ? `${stats.estimatedHoursSaved}h` : '—'} />
      <StatTile label="Leads captured" value={stats?.totalLeadsCaptured ?? '—'} />
    </div>
  )
}

function DocumentRow({ clientId, doc, file, onChanged }: {
  clientId: string
  doc: KnowledgeDoc
  file: KnowledgeFile | undefined
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [description, setDescription] = useState(doc.description ?? '')
  const replaceInputRef = useRef<HTMLInputElement>(null)

  async function remove() {
    if (!window.confirm(`Delete "${doc.title}"? This can't be undone.`)) return
    setBusy(true)
    try {
      await api.clients.deleteKnowledgeDocument(clientId, doc.id)
      onChanged()
      toast.success('Document deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete document')
    } finally {
      setBusy(false)
    }
  }

  async function saveDescription() {
    if (description === (doc.description ?? '')) return
    try {
      await api.clients.updateKnowledgeDescription(clientId, doc.id, description)
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save description')
    }
  }

  // Upload a new file for this document — works for any document, not just
  // ones that started as a file upload. Old content (and description) is
  // replaced by the new file; the description is captured first and
  // reapplied to the new document afterward.
  async function onReplaceFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      const priorDescription = doc.description
      await api.clients.deleteKnowledgeDocument(clientId, doc.id)
      const { documentId } = await api.clients.uploadKnowledge(clientId, file)
      if (priorDescription) {
        await api.clients.updateKnowledgeDescription(clientId, documentId, priorDescription)
      }
      onChanged()
      toast.success(`Replaced with "${file.name}"`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to replace file')
    } finally {
      setBusy(false)
      if (replaceInputRef.current) replaceInputRef.current.value = ''
    }
  }

  return (
    <TableRow>
      <TableCell className="font-medium">
        {file ? (
          <KnowledgeFilePreview clientId={clientId} file={file} compact label={doc.title} />
        ) : (
          doc.title
        )}
      </TableCell>
      <TableCell>
        <Input
          value={description}
          onChange={e => setDescription(e.target.value)}
          onBlur={saveDescription}
          placeholder="Add a note"
          className="h-8 text-xs"
        />
      </TableCell>
      <TableCell className="text-muted-foreground">{new Date(doc.created_at).toLocaleDateString()}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" disabled={busy} onClick={() => replaceInputRef.current?.click()} title="Upload a new file to replace this document's content">
            <RefreshCw className="h-3.5 w-3.5" /> Replace
          </Button>
          <input ref={replaceInputRef} type="file" accept=".pdf,.docx,.txt,.md,.csv,.xlsx,.pptx" onChange={onReplaceFileChosen} className="hidden" />
          <Button variant="outline" size="sm" disabled={busy} onClick={remove} title="Delete this document">
            <Trash2 className="h-3.5 w-3.5 text-destructive" /> Delete
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

function KnowledgeTab({ clientId }: { clientId: string }) {
  const key = ['knowledge', clientId]
  const filesKey = ['knowledge-files', clientId]
  const { data: docs } = useSWR(key, () => api.clients.knowledge(clientId))
  const { data: files } = useSWR(filesKey, () => api.clients.knowledgeFiles(clientId))
  const [mode, setMode] = useState<'upload' | 'paste'>('upload')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function add() {
    if (!title || !content) return
    setSaving(true)
    try {
      await api.clients.addKnowledge(clientId, title, content, description || undefined)
      setTitle(''); setContent(''); setDescription('')
      mutate(key)
      toast.success('Document added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add document')
    } finally {
      setSaving(false)
    }
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await api.clients.uploadKnowledge(clientId, file, description || undefined)
      setDescription('')
      mutate(key)
      mutate(filesKey)
      toast.success(`Uploaded "${file.name}"`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Add to knowledge base</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          <div className="inline-flex w-fit items-center gap-1 rounded-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => setMode('upload')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${mode === 'upload' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Upload a file
            </button>
            <button
              type="button"
              onClick={() => setMode('paste')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${mode === 'paste' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Paste text
            </button>
          </div>

          {mode === 'upload' ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                We'll pull the title and text out of the file automatically — nothing else to fill in.
              </p>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Add a note (optional)" />
              <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="justify-self-start">
                <Upload className="h-4 w-4" />
                {uploading ? 'Uploading…' : 'Choose a file (PDF, Word, Excel, PowerPoint, txt, md, csv)'}
              </Button>
              <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt,.md,.csv,.xlsx,.pptx" onChange={onFileChosen} className="hidden" />
            </div>
          ) : (
            <div className="grid gap-2">
              <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Document title" />
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)" />
              <Textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Content…" rows={4} />
              <Button onClick={add} disabled={saving} className="justify-self-start">
                {saving ? 'Adding…' : 'Add document'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        {docs?.length ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Title</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Added</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map(d => (
                <DocumentRow
                  key={d.id}
                  clientId={clientId}
                  doc={d}
                  file={files?.find(f => f.id === d.fileId)}
                  onChanged={() => { mutate(key); mutate(filesKey) }}
                />
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState icon={FileText} title="No documents yet" description="Upload a file or paste text above to build the knowledge base." />
        )}
      </Card>
    </div>
  )
}

// ── Widget setup ─────────────────────────────────────────────────────────────
// Appearance is stored per client and fetched by widget.js at load, so editing
// here reaches the client's live site on their next page load — they paste the
// snippet once and never touch it again.
//
// One Cloudflare Worker serves every client: the snippet below differs only by
// data-client-id. There is no per-client Worker to deploy.
const WIDGET_URL = import.meta.env.VITE_WIDGET_URL ?? 'https://agent-widget.hyperboledigital.workers.dev/widget.js'
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

// ⚠️ These mirror the built-in fallbacks in apps/widget/src/widget.js (CHIPS
// and PROMPT_LABELS). They are duplicated on purpose and must be kept in sync
// by hand: widget.js is served standalone from the Worker with no build step,
// so it cannot import from a shared package — and its whole job as a fallback
// is to still render when this API is unreachable.
const DEFAULT_CHIPS = [
  { label: 'What do you offer?', message: 'What services do you offer?' },
  { label: 'Pricing', message: 'How much does it cost?' },
  { label: 'Book a call', message: 'Can I book a call?' },
  { label: 'Contact us', message: 'I want to contact support' }
]

const defaultPrompts = (title: string) => [
  'Questions?',
  "What's your pricing?",
  `How does ${title} work?`,
  'Can I book a call?',
  'Need support?'
]

// Logo: either an uploaded file (stored by us, served from our own origin) or a
// URL the client hosts elsewhere. An upload wins over the URL, which is why
// this is one control rather than two independent fields.
//
// The upload saves immediately rather than waiting for "Save widget settings" —
// it's a file write with its own success/failure, and pretending it's part of
// the form draft would mean holding bytes in memory and re-uploading on every
// unrelated save.
function LogoField({ client, draft, onUrlChange }: {
  client: Client
  draft: WidgetConfig
  onUrlChange: (v: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const uploaded = !!client.widgetConfig?.logoPath
  // Cache-bust so a replaced logo doesn't show the old one from the 5m cache.
  const preview = uploaded
    ? `${API_URL}/widget-config/${client.id}/logo?v=${encodeURIComponent(client.widgetConfig!.logoPath!)}`
    : (draft.logo || '')

  async function upload(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      await api.clients.uploadWidgetLogo(client.id, file)
      mutate(['client', client.id])
      toast.success('Logo uploaded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await api.clients.removeWidgetLogo(client.id)
      mutate(['client', client.id])
      toast.success('Logo removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove logo')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Logo</Label>
      <p className="text-xs text-muted-foreground">
        Shown on the chat bubble and in the panel header. Both sit on the brand colour, so a
        light/white mark reads best. PNG, JPEG, WebP, SVG or GIF, up to 1MB.
      </p>
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border"
             style={{ background: draft.color || '#6C5CE7' }}>
          {preview
            ? <img src={preview} alt="Widget logo" className="h-[52%] w-[52%] object-contain" />
            : <span className="text-lg font-bold text-white">
                {draft.avatarEmoji || (draft.title || client.name).charAt(0).toUpperCase()}
              </span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
            className="hidden"
            onChange={e => { upload(e.target.files?.[0]); e.target.value = '' }}
          />
          <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" />{busy ? 'Working…' : uploaded ? 'Replace' : 'Upload logo'}
          </Button>
          {uploaded && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={remove}>
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </Button>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">…or link one you host elsewhere</Label>
        <Input
          value={draft.logo ?? ''}
          onChange={e => onUrlChange(e.target.value)}
          placeholder="https://…/logo.svg"
          disabled={uploaded}
        />
        {uploaded && (
          <span className="text-xs text-muted-foreground">
            An uploaded logo is in use — remove it to fall back to a URL.
          </span>
        )}
      </div>
    </div>
  )
}

function WidgetTab({ client }: { client: Client }) {
  const cfg = client.widgetConfig ?? {}
  const [draft, setDraft] = useState<WidgetConfig>(cfg)
  const [saving, setSaving] = useState(false)

  // Both lists are all-or-nothing overrides: saving even one item replaces the
  // widget's built-in set entirely. So seed the editor with the full defaults
  // rather than a blank row — otherwise "add one prompt" silently deletes the
  // other four, which is not what anyone means by adding a prompt.
  const chips = draft.chips?.length ? draft.chips : DEFAULT_CHIPS
  const fallbackPrompts = defaultPrompts(draft.title || client.name)
  const prompts = draft.prompts?.length ? draft.prompts : fallbackPrompts
  const usingDefaultChips = !draft.chips?.length
  const domains = draft.allowedDomains ?? []
  const usingDefaultPrompts = !draft.prompts?.length

  const snippet = `<script
  src="${WIDGET_URL}"
  data-client-id="${client.id}"
  data-api-url="${API_URL}"
></script>`

  function set<K extends keyof WidgetConfig>(key: K, value: WidgetConfig[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  async function save() {
    setSaving(true)
    try {
      // Strip empties so an untouched field falls back to the widget's built-in
      // default rather than persisting "" and rendering blank.
      //
      // logoPath/logoContentType are deliberately re-read from `client` rather
      // than `draft`: uploading a logo writes them server-side, but `draft` was
      // snapshotted at mount, so spreading it alone would silently wipe a logo
      // uploaded during this editing session.
      const clean: WidgetConfig = {
        ...draft,
        logoPath: client.widgetConfig?.logoPath,
        logoContentType: client.widgetConfig?.logoContentType,
        prompts: (draft.prompts ?? []).map(p => p.trim()).filter(Boolean),
        chips: (draft.chips ?? []).filter(c => c.label.trim() && c.message.trim()).slice(0, 4),
        allowedDomains: (draft.allowedDomains ?? []).map(d => d.trim()).filter(Boolean)
      }
      await api.clients.upsert({ id: client.id, widgetConfig: clean })
      mutate(['client', client.id])
      toast.success('Widget settings saved — live on their site within a minute')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save widget settings')
    } finally {
      setSaving(false)
    }
  }

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet)
      toast.success('Embed snippet copied')
    } catch {
      toast.error('Could not copy — select the snippet and copy manually')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Code2 className="h-4 w-4 text-primary" /> Embed snippet</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          <p className="text-sm text-muted-foreground">
            Paste this into the client's site, just before <code className="rounded bg-muted px-1">&lt;/body&gt;</code>.
            They only ever paste it once — everything below is read from here at load, so changing
            their branding later doesn't require touching their website again.
          </p>
          <div className="flex flex-col rounded-md border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
              <span className="text-xs font-medium text-muted-foreground">Embed code</span>
              <button onClick={copySnippet} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <Copy className="h-3 w-3" /> Copy
              </button>
            </div>
            <pre className="overflow-auto px-3 py-2 font-mono text-xs leading-relaxed">{snippet}</pre>
          </div>
          {API_URL.includes('localhost') && (
            <p className="text-xs text-warning">
              Heads up: <code className="rounded bg-muted px-1">data-api-url</code> points at localhost, which a live
              site can't reach. Set <code className="rounded bg-muted px-1">VITE_API_URL</code> to your deployed (or
              tunnelled) API URL before sending this to a client.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Title</Label>
              <Input value={draft.title ?? ''} onChange={e => set('title', e.target.value)} placeholder={client.name} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Tagline</Label>
              <Input value={draft.tagline ?? ''} onChange={e => set('tagline', e.target.value)} placeholder="You can ask me anything" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Welcome message</Label>
              <Input value={draft.welcome ?? ''} onChange={e => set('welcome', e.target.value)} placeholder="How can I help you today?" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Input placeholder</Label>
              <Input value={draft.placeholder ?? ''} onChange={e => set('placeholder', e.target.value)} placeholder="Type a message..." />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Brand colour</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={draft.color || '#6C5CE7'}
                  onChange={e => set('color', e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-border bg-background"
                />
                <Input value={draft.color ?? ''} onChange={e => set('color', e.target.value)} placeholder="#6C5CE7" className="flex-1" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Secondary colour <span className="text-muted-foreground">(gradients)</span></Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={draft.color2 || draft.color || '#6C5CE7'}
                  onChange={e => set('color2', e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-border bg-background"
                />
                <Input value={draft.color2 ?? ''} onChange={e => set('color2', e.target.value)} placeholder="defaults to brand colour" className="flex-1" />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Avatar emoji <span className="text-muted-foreground">(used if no logo)</span></Label>
              <Input value={draft.avatarEmoji ?? ''} onChange={e => set('avatarEmoji', e.target.value)} placeholder="💬" />
            </div>
          </div>

          <LogoField client={client} draft={draft} onUrlChange={v => set('logo', v)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Teaser prompts</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          <p className="text-sm text-muted-foreground">
            Short questions that rotate above the widget while it's closed, to invite a click.
            {usingDefaultPrompts && ' Showing the built-in defaults — edit them and save to make them this client\'s own.'}
          </p>
          {prompts.map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={p}
                onChange={e => {
                  const next = [...prompts]; next[i] = e.target.value; set('prompts', next)
                }}
                placeholder="Can I book a call?"
              />
              <button
                onClick={() => set('prompts', prompts.filter((_, j) => j !== i))}
                aria-label={`Remove prompt ${i + 1}`}
                className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => set('prompts', [...prompts, ''])}>
              <Plus className="h-3.5 w-3.5" /> Add prompt
            </Button>
            {!usingDefaultPrompts && (
              <Button variant="ghost" size="sm" onClick={() => set('prompts', fallbackPrompts)}>
                <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Allowed domains</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          <p className="text-sm text-muted-foreground">
            Lock this widget to the client's own site. Subdomains are included automatically, so{' '}
            <code className="rounded bg-muted px-1">spec-id.com</code> also covers{' '}
            <code className="rounded bg-muted px-1">www.spec-id.com</code>. Anywhere else, the widget
            refuses to load and the assistant returns an error.
          </p>
          {domains.length === 0 && (
            <p className="text-xs text-warning">
              No domains set — this widget currently runs on <strong>any</strong> website that has the
              script and this client's ID.
            </p>
          )}
          {domains.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={d}
                onChange={e => {
                  const next = [...domains]; next[i] = e.target.value; set('allowedDomains', next)
                }}
                placeholder="spec-id.com"
              />
              <button
                onClick={() => set('allowedDomains', domains.filter((_, j) => j !== i))}
                aria-label={`Remove domain ${i + 1}`}
                className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <Button variant="outline" size="sm" className="w-fit" onClick={() => set('allowedDomains', [...domains, ''])}>
            <Plus className="h-3.5 w-3.5" /> Add domain
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Quick-reply buttons</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          <p className="text-sm text-muted-foreground">
            The buttons shown inside the chat when a visitor first opens it. <strong>Label</strong> is what they
            see; <strong>message</strong> is what actually gets sent to the assistant. Four maximum.
            {usingDefaultChips && ' Showing the built-in defaults — edit them and save to make them this client\'s own.'}
          </p>
          {chips.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={c.label}
                onChange={e => {
                  const next = [...chips]; next[i] = { ...next[i], label: e.target.value }; set('chips', next)
                }}
                placeholder="Book a call"
                className="w-1/3"
              />
              <Input
                value={c.message}
                onChange={e => {
                  const next = [...chips]; next[i] = { ...next[i], message: e.target.value }; set('chips', next)
                }}
                placeholder="Can I book a call?"
                className="flex-1"
              />
              <button
                onClick={() => set('chips', chips.filter((_, j) => j !== i))}
                aria-label={`Remove button ${i + 1}`}
                className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            {chips.length < 4 && (
              <Button variant="outline" size="sm" onClick={() => set('chips', [...chips, { label: '', message: '' }])}>
                <Plus className="h-3.5 w-3.5" /> Add button
              </Button>
            )}
            {!usingDefaultChips && (
              <Button variant="ghost" size="sm" onClick={() => set('chips', DEFAULT_CHIPS)}>
                <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save widget settings'}</Button>
      </div>
    </div>
  )
}

export default function Assistant() {
  const { clientId, client } = useClientCtx()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Chat Assistant</h2>
        <p className="text-sm text-muted-foreground">What your assistant does, how it's performing, and what it knows.</p>
      </div>

      <AssistantCard />

      <h3 className="text-sm font-semibold text-muted-foreground">Overview</h3>
      <OverviewTab clientId={clientId} />

      <h3 className="text-sm font-semibold text-muted-foreground">Widget setup</h3>
      {client
        ? <WidgetTab client={client} />
        : <Card><CardContent className="py-6 text-sm text-muted-foreground">Loading widget settings…</CardContent></Card>}

      <h3 className="text-sm font-semibold text-muted-foreground">Knowledge base</h3>
      <KnowledgeTab clientId={clientId} />
    </div>
  )
}
