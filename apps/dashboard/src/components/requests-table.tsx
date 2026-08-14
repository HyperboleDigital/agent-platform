import { Fragment, useMemo, useRef, useState } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { Paperclip, Send, XCircle, ChevronRight, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import type { ChangeRequest, RequestStatus, MentionableUser } from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Label } from '@/components/ui/input'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { AttachmentPreview } from '@/components/attachment-preview'
import { Markdown } from '@/components/markdown'

// Shared everywhere a change request shows up (client Home, the Requests
// page, and the superadmin Overview cross-client queue) so the same
// expand-for-detail / comment / attach / cancel / status-change actions work
// identically no matter where you're looking at a request from.

export function statusVariant(status: RequestStatus): 'success' | 'warning' | 'secondary' | 'destructive' {
  if (status === 'done') return 'success'
  if (status === 'in_progress') return 'warning'
  if (status === 'declined' || status === 'cancelled') return 'destructive'
  return 'secondary'
}

export function statusLabel(status: RequestStatus): string {
  switch (status) {
    case 'in_progress': return 'In progress'
    case 'done': return 'Done'
    case 'declined': return 'Declined'
    case 'cancelled': return 'Cancelled'
    default: return 'Open'
  }
}

export const STATUSES: RequestStatus[] = ['open', 'in_progress', 'done', 'declined']
export const ACTIVE_STATUSES = new Set<RequestStatus>(['open', 'in_progress'])
export const HISTORY_STATUSES = new Set<RequestStatus>(['done', 'declined', 'cancelled'])

function statusChangeLabel(status: RequestStatus | null): string {
  return status ? statusLabel(status) : 'Created'
}

// Row shape used everywhere a list of requests is rendered — clientName is
// only present in the superadmin cross-client queue.
export type RequestRow = ChangeRequest & { clientName?: string }

// Renders a comment body with any "@Full Name" mentions bolded, so a mention
// reads clearly in the thread without needing a rich-text editor.
function CommentBody({ body, mentionNames }: { body: string; mentionNames: string[] }) {
  if (mentionNames.length === 0) return <>{body}</>
  const pattern = new RegExp(`(@(?:${mentionNames.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}))`, 'g')
  const parts = body.split(pattern)
  return <>{parts.map((p, i) => (mentionNames.some(n => p === `@${n}`) ? <span key={i} className="font-medium text-primary">{p}</span> : <Fragment key={i}>{p}</Fragment>))}</>
}

// A plain text input with an "@" autocomplete: typing "@" + a few letters opens
// a dropdown of mentionable users (the Hyperbole team + the client's own org
// members); picking one inserts "@Full Name " and records their Clerk user ID
// so the backend can notify them directly. Selection is explicit (click/enter
// on a real suggestion), never inferred from free text, so notifying the right
// person is reliable even with names that contain spaces.
function MentionComposer({
  value, onChange, mentionIds, onMentionIdsChange, onSubmit, disabled, users,
}: {
  value: string
  onChange: (v: string) => void
  mentionIds: string[]
  onMentionIdsChange: (ids: string[]) => void
  onSubmit: () => void
  disabled: boolean
  users: MentionableUser[]
}) {
  const [query, setQuery] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const suggestions = useMemo(() => {
    if (query === null) return []
    const q = query.toLowerCase()
    return users.filter(u => u.name.toLowerCase().includes(q)).slice(0, 6)
  }, [query, users])

  function handleChange(v: string) {
    onChange(v)
    const cursor = inputRef.current?.selectionStart ?? v.length
    const upToCursor = v.slice(0, cursor)
    const match = upToCursor.match(/@([^\s@]*)$/)
    setQuery(match ? match[1] : null)
  }

  function pick(u: MentionableUser) {
    const cursor = inputRef.current?.selectionStart ?? value.length
    const upToCursor = value.slice(0, cursor)
    const start = upToCursor.search(/@[^\s@]*$/)
    if (start === -1) return
    const next = `${value.slice(0, start)}@${u.name} ${value.slice(cursor)}`
    onChange(next)
    onMentionIdsChange([...new Set([...mentionIds, u.id])])
    setQuery(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  return (
    <div className="relative flex-1">
      <Input
        ref={inputRef}
        value={value}
        onChange={e => handleChange(e.target.value)}
        placeholder="Add a comment… (@ to mention someone)"
        onKeyDown={e => {
          if (e.key === 'Enter' && query === null) onSubmit()
          if (e.key === 'Escape') setQuery(null)
        }}
        disabled={disabled}
      />
      {query !== null && suggestions.length > 0 && (
        <div className="absolute bottom-full z-10 mb-1 w-56 rounded-md border border-border bg-popover shadow-md">
          {suggestions.map(u => (
            <button
              key={u.id}
              type="button"
              onClick={() => pick(u)}
              className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-accent"
            >
              <span>{u.name}</span>
              {u.isSuperadmin && <span className="text-xs text-muted-foreground">Hyperbole</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// Inline expand-in-place detail: status timeline, comment thread,
// attachments, and (for the client, while still cancellable) a cancel
// action with a required reason.
export function RequestDetailPanel({ clientId, requestId }: { clientId: string; requestId: string }) {
  const key = ['request-detail', clientId, requestId]
  const { data: detail, isLoading } = useSWR(key, () => api.clients.requestDetail(clientId, requestId))
  const { data: me } = useSWR('me', api.me)
  const { data: mentionableUsers } = useSWR(['mentionable-users', clientId], () => api.clients.mentionableUsers(clientId))
  const [comment, setComment] = useState('')
  const [mentionIds, setMentionIds] = useState<string[]>([])
  const [posting, setPosting] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [showCancel, setShowCancel] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function postComment() {
    const trimmed = comment.trim()
    if (!trimmed) return
    setPosting(true)
    try {
      // Only notify mentions whose "@Name" is still actually present in the
      // text — protects against a stale ping if the user deleted it after picking.
      const stillPresent = mentionIds.filter(id => {
        const u = mentionableUsers?.find(u => u.id === id)
        return u && trimmed.includes(`@${u.name}`)
      })
      await api.clients.addRequestComment(clientId, requestId, trimmed, stillPresent)
      setComment('')
      setMentionIds([])
      mutate(key)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to post comment')
    } finally {
      setPosting(false)
    }
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setAttaching(true)
    try {
      await api.clients.uploadRequestAttachment(clientId, requestId, file)
      mutate(key)
      toast.success(`Attached "${file.name}"`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to attach file')
    } finally {
      setAttaching(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function submitCancel() {
    if (!cancelReason.trim()) return
    setCancelling(true)
    try {
      await api.clients.cancelRequest(clientId, requestId, cancelReason.trim())
      mutate(key)
      mutate(['requests', clientId])
      toast.success('Request cancelled')
      setShowCancel(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel request')
    } finally {
      setCancelling(false)
    }
  }

  if (isLoading || !detail) return <Skeleton className="h-40 w-full" />

  const { request, events, comments, attachments } = detail
  const canCancel = !me?.isSuperadmin && ACTIVE_STATUSES.has(request.status)

  return (
    <div className="flex flex-col gap-4 border-t border-border p-4">
      {request.description && <Markdown content={request.description} className="text-muted-foreground" />}

      <div>
        <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Status history</div>
        <div className="flex flex-col gap-1">
          {events.map(e => (
            <div key={e.id} className="flex items-center gap-2 text-xs text-muted-foreground">
              <StatusDot variant={statusVariant(e.toStatus)} />
              <span className="font-medium text-foreground">{statusChangeLabel(e.toStatus)}</span>
              <span>{new Date(e.createdAt).toLocaleString()}</span>
              {e.note && <span className="italic">— {e.note}</span>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Attachments</span>
          <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()} disabled={attaching}>
            <Paperclip className="h-3.5 w-3.5" /> {attaching ? 'Uploading…' : 'Attach file'}
          </Button>
          <input ref={fileInputRef} type="file" onChange={onFileChosen} className="hidden" />
        </div>
        {attachments.length ? (
          <div className="flex flex-wrap gap-3">
            {attachments.map(a => (
              <AttachmentPreview key={a.id} clientId={clientId} requestId={requestId} attachment={a} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No attachments yet.</p>
        )}
      </div>

      <div>
        <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Comments</div>
        <div className="flex flex-col gap-2">
          {comments.map(c => {
            const mentionNames = c.mentions.map(id => mentionableUsers?.find(u => u.id === id)?.name).filter((n): n is string => !!n)
            return (
              <div key={c.id} className="rounded-md border border-border px-3 py-2 text-sm">
                <div className="mb-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{c.authorName}</span>
                  <span>{new Date(c.createdAt).toLocaleString()}</span>
                </div>
                <CommentBody body={c.body} mentionNames={mentionNames} />
              </div>
            )
          })}
          {!comments.length && <p className="text-xs text-muted-foreground">No comments yet.</p>}
        </div>
        <div className="mt-2 flex gap-2">
          <MentionComposer
            value={comment}
            onChange={setComment}
            mentionIds={mentionIds}
            onMentionIdsChange={setMentionIds}
            onSubmit={postComment}
            disabled={posting}
            users={mentionableUsers ?? []}
          />
          <Button variant="secondary" size="sm" onClick={postComment} disabled={posting || !comment.trim()}>
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {canCancel && (
        <div>
          {!showCancel ? (
            <Button variant="outline" size="sm" onClick={() => setShowCancel(true)}>
              <XCircle className="h-3.5 w-3.5" /> Cancel request
            </Button>
          ) : (
            <div className="flex flex-col gap-2 rounded-md border border-border p-3">
              <Label>Reason for cancelling</Label>
              <Textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={2} />
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" onClick={submitCancel} disabled={cancelling || !cancelReason.trim()}>
                  {cancelling ? 'Cancelling…' : 'Confirm cancel'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowCancel(false)}>Never mind</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// `showClient` adds a Client column (for the superadmin cross-client queue —
// each row already carries its own clientId, so a single table can mix rows
// from different clients without any other prop plumbing).
export function RequestsTable({ requests, isSuperadmin, expandedId, onToggle, onChangeStatus, onDelete, showClient = false }: {
  requests: RequestRow[]
  isSuperadmin: boolean
  expandedId: string | null
  onToggle: (id: string) => void
  onChangeStatus: (clientId: string, reqId: string, status: RequestStatus) => void
  // Optional so callers that only triage (the cross-client Overview list) can
  // reuse this table without having to implement deletion.
  onDelete?: (clientId: string, reqId: string, title: string) => void
  showClient?: boolean
}) {
  const colSpan = 3 + (showClient ? 1 : 0) + (isSuperadmin ? 1 : 0)
  return (
    <Card className="overflow-hidden p-0">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {showClient && <TableHead>Client</TableHead>}
            <TableHead>Request</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Submitted</TableHead>
            {isSuperadmin && <TableHead>Update</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {requests.map(r => {
            const expanded = expandedId === r.id
            return (
              <Fragment key={r.id}>
                <TableRow className="cursor-pointer" onClick={() => onToggle(r.id)}>
                  {showClient && (
                    <TableCell className="font-medium text-primary">{r.clientName}</TableCell>
                  )}
                  <TableCell>
                    <div className="flex items-center gap-1.5 font-medium">
                      <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
                      {r.title}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(r.status)}>
                      <StatusDot variant={statusVariant(r.status)} />
                      {statusLabel(r.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</TableCell>
                  {isSuperadmin && (
                    <TableCell>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        {STATUSES.filter(s => s !== r.status).map(s => (
                          <Button key={s} variant="outline" size="sm" onClick={() => onChangeStatus(r.clientId, r.id, s)}>
                            {statusLabel(s)}
                          </Button>
                        ))}
                        {onDelete && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete request: ${r.title}`}
                            title="Delete this request"
                            className="ml-1 h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={() => onDelete(r.clientId, r.id, r.title)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
                {expanded && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={colSpan} className="p-0">
                      <RequestDetailPanel clientId={r.clientId} requestId={r.id} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}
