import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { Sparkles, Download, Upload, Eye, Pencil } from 'lucide-react'
import { api } from '@/lib/api'
import type { BlogPost, PostStatus } from '@/lib/api'
import { useClientCtx } from '@/pages/client/ClientLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Label } from '@/components/ui/input'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'
import { MarkdownPreview } from '@/components/markdown-preview'
import { FramerConnectionCard } from '@/components/framer-connection-card'

function statusVariant(status: PostStatus): 'secondary' | 'warning' | 'success' | 'default' {
  if (status === 'published') return 'success'
  if (status === 'approved') return 'default'
  if (status === 'in_review') return 'warning'
  return 'secondary'
}

function statusLabel(status: PostStatus): string {
  switch (status) {
    case 'in_review': return 'In review'
    case 'approved': return 'Approved'
    case 'published': return 'Published'
    case 'archived': return 'Archived'
    default: return 'Draft'
  }
}

function GenerateCard({ clientId, onGenerated }: { clientId: string; onGenerated: (postId: string) => void }) {
  const { data: opportunities } = useSWR(['seo-opportunities', clientId], () => api.clients.seoOpportunities(clientId).catch(() => []))
  const [brief, setBrief] = useState('')
  const [targetKeyword, setTargetKeyword] = useState('')
  const [generating, setGenerating] = useState(false)

  async function generate() {
    if (!brief.trim() || !targetKeyword.trim()) return
    setGenerating(true)
    try {
      const post = await api.clients.generatePost(clientId, brief.trim(), targetKeyword.trim())
      setBrief(''); setTargetKeyword('')
      mutate(['posts', clientId])
      onGenerated(post.id)
      toast.success('Draft generated — review it below')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate draft')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>New post</CardTitle></CardHeader>
      <CardContent className="grid gap-3 pt-0">
        <div className="grid gap-1.5">
          <Label>Target keyword</Label>
          <Input value={targetKeyword} onChange={e => setTargetKeyword(e.target.value)} placeholder="e.g. commercial roof repair cost" />
          {!!opportunities?.length && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs text-muted-foreground">From your rankings:</span>
              {opportunities.slice(0, 5).map(o => (
                <button
                  key={o.query}
                  onClick={() => setTargetKeyword(o.query)}
                  className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
                >
                  {o.query}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid gap-1.5">
          <Label>Brief — what should this post cover?</Label>
          <Textarea value={brief} onChange={e => setBrief(e.target.value)} rows={3} placeholder="What angle, audience, and key points should the post hit?" />
        </div>
        <Button onClick={generate} disabled={generating || !brief.trim() || !targetKeyword.trim()} className="justify-self-start">
          <Sparkles className="h-4 w-4" />
          {generating ? 'Writing…' : 'Generate draft'}
        </Button>
      </CardContent>
    </Card>
  )
}

const EDITABLE: PostStatus[] = ['draft', 'in_review', 'approved']

function PostEditor({ clientId, post }: { clientId: string; post: BlogPost }) {
  const key = ['posts', clientId]
  const [title, setTitle] = useState(post.title ?? '')
  const [slug, setSlug] = useState(post.slug ?? '')
  const [metaDescription, setMetaDescription] = useState(post.metaDescription ?? '')
  const [contentMd, setContentMd] = useState(post.contentMd ?? '')
  const [mode, setMode] = useState<'edit' | 'preview'>('preview')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const editable = EDITABLE.includes(post.status)

  async function save() {
    setSaving(true)
    try {
      await api.clients.updatePost(clientId, post.id, { title, slug, metaDescription, contentMd })
      mutate(key)
      toast.success('Saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function transition(status: PostStatus) {
    setBusy(true)
    try {
      await api.clients.transitionPost(clientId, post.id, status)
      mutate(key)
      toast.success(`Moved to ${statusLabel(status).toLowerCase()}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setBusy(false)
    }
  }

  async function publish() {
    setBusy(true)
    try {
      await api.clients.publishPost(clientId, post.id)
      mutate(key)
      toast.success('Published to Framer')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to publish — check your Framer connection')
    } finally {
      setBusy(false)
    }
  }

  async function exportMd() {
    try {
      await api.clients.exportPost(clientId, post.id, `${post.slug || post.id}.md`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed')
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CardTitle className="truncate">{title || '(untitled)'}</CardTitle>
            <Badge variant={statusVariant(post.status)}>
              <StatusDot variant={statusVariant(post.status) as 'success' | 'warning' | 'secondary' | 'default'} />
              {statusLabel(post.status)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Keyword: {post.targetKeyword}</p>
        </div>
        {editable && (
          <Button variant="ghost" size="sm" onClick={() => setMode(mode === 'edit' ? 'preview' : 'edit')}>
            {mode === 'edit' ? <><Eye className="h-3.5 w-3.5" /> Preview</> : <><Pencil className="h-3.5 w-3.5" /> Edit</>}
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {editable && mode === 'edit' ? (
          <>
            <div className="grid gap-1.5">
              <Label>Title</Label>
              <Input value={title} onChange={e => setTitle(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Slug</Label>
              <Input value={slug} onChange={e => setSlug(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Meta description ({metaDescription.length} chars)</Label>
              <Textarea value={metaDescription} onChange={e => setMetaDescription(e.target.value)} rows={2} />
            </div>
            <div className="grid gap-1.5">
              <Label>Body (markdown)</Label>
              <Textarea value={contentMd} onChange={e => setContentMd(e.target.value)} rows={16} className="font-mono text-xs" />
            </div>
            <Button onClick={save} disabled={saving} size="sm" className="justify-self-start">
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        ) : (
          <>
            {!editable && (
              <p className="text-xs text-muted-foreground">
                {post.status === 'published' && post.publishedAt
                  ? `Published to Framer on ${new Date(post.publishedAt).toLocaleDateString()} — read-only record of what went live.`
                  : post.status === 'archived'
                    ? 'Archived — read-only.'
                    : 'Read-only.'}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{metaDescription}</p>
            <div className="rounded-md border border-border p-4">
              <MarkdownPreview markdown={contentMd} />
            </div>
          </>
        )}

        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {post.status === 'draft' && (
            <Button size="sm" onClick={() => transition('in_review')} disabled={busy}>Submit for review</Button>
          )}
          {post.status === 'in_review' && (
            <>
              <Button size="sm" onClick={() => transition('approved')} disabled={busy}>Approve</Button>
              <Button size="sm" variant="outline" onClick={() => transition('draft')} disabled={busy}>Send back to draft</Button>
            </>
          )}
          {post.status === 'approved' && (
            <>
              <Button size="sm" onClick={publish} disabled={busy}><Upload className="h-3.5 w-3.5" /> Publish to Framer</Button>
              <Button size="sm" variant="outline" onClick={() => transition('draft')} disabled={busy}>Send back to draft</Button>
            </>
          )}
          {post.status !== 'archived' && (
            <Button size="sm" variant="ghost" onClick={() => transition('archived')} disabled={busy}>Archive</Button>
          )}
          <Button size="sm" variant="ghost" onClick={exportMd}><Download className="h-3.5 w-3.5" /> Export .md</Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default function Content() {
  const { clientId } = useClientCtx()
  const { data: posts, isLoading } = useSWR(['posts', clientId], () => api.clients.posts(clientId))
  const { data: me } = useSWR('me', api.me)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = posts?.find(p => p.id === selectedId) ?? posts?.[0] ?? null

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Content Engine</h2>
        <p className="text-sm text-muted-foreground">AI-drafted, keyword-targeted blog posts — review before anything goes live.</p>
      </div>

      <GenerateCard clientId={clientId} onGenerated={setSelectedId} />

      {isLoading && <Skeleton className="h-40 w-full" />}

      {!isLoading && posts?.length === 0 && (
        <Card>
          <CardContent>
            <EmptyState icon={Sparkles} title="No posts yet" description="Generate your first draft above." />
          </CardContent>
        </Card>
      )}

      {!!posts?.length && (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <Card className="h-fit overflow-hidden p-0">
            <div className="p-3 pb-1"><span className="text-xs font-medium text-muted-foreground">Posts</span></div>
            <div className="flex flex-col">
              {posts.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`flex flex-col items-start gap-1 border-t border-border px-3 py-2.5 text-left text-sm transition-colors first:border-t-0 hover:bg-accent/60 ${
                    selected?.id === p.id ? 'bg-accent' : ''
                  }`}
                >
                  <span className="line-clamp-1 font-medium">{p.title || '(untitled)'}</span>
                  <Badge variant={statusVariant(p.status)} className="text-[10px]">
                    <StatusDot variant={statusVariant(p.status) as 'success' | 'warning' | 'secondary' | 'default'} />
                    {statusLabel(p.status)}
                  </Badge>
                </button>
              ))}
            </div>
          </Card>
          {selected && <PostEditor clientId={clientId} post={selected} />}
        </div>
      )}

      {me?.isSuperadmin && <FramerConnectionCard clientId={clientId} />}
    </div>
  )
}
