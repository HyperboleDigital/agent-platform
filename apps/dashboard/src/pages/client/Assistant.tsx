import { useRef, useState } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { Bot, MessageSquare, Sparkles, Upload, FileText, LifeBuoy, Trash2, RefreshCw } from 'lucide-react'
import type { KnowledgeDoc, KnowledgeFile } from '@/lib/api'
import { api } from '@/lib/api'
import { useClientCtx } from '@/pages/client/ClientLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
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

export default function Assistant() {
  const { clientId } = useClientCtx()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Chat Assistant</h2>
        <p className="text-sm text-muted-foreground">What your assistant does, how it's performing, and what it knows.</p>
      </div>

      <AssistantCard />

      <h3 className="text-sm font-semibold text-muted-foreground">Overview</h3>
      <OverviewTab clientId={clientId} />

      <h3 className="text-sm font-semibold text-muted-foreground">Knowledge base</h3>
      <KnowledgeTab clientId={clientId} />
    </div>
  )
}
