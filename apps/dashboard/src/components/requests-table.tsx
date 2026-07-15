import { Fragment, useRef, useState } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { Paperclip, Send, XCircle, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import type { ChangeRequest, RequestStatus } from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Label } from '@/components/ui/input'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { AttachmentPreview } from '@/components/attachment-preview'

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

// Inline expand-in-place detail: status timeline, comment thread,
// attachments, and (for the client, while still cancellable) a cancel
// action with a required reason.
export function RequestDetailPanel({ clientId, requestId }: { clientId: string; requestId: string }) {
  const key = ['request-detail', clientId, requestId]
  const { data: detail, isLoading } = useSWR(key, () => api.clients.requestDetail(clientId, requestId))
  const { data: me } = useSWR('me', api.me)
  const [comment, setComment] = useState('')
  const [posting, setPosting] = useState(false)
  const [attaching, setAttaching] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [showCancel, setShowCancel] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function postComment() {
    if (!comment.trim()) return
    setPosting(true)
    try {
      await api.clients.addRequestComment(clientId, requestId, comment.trim())
      setComment('')
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
      {request.description && <p className="text-sm text-muted-foreground">{request.description}</p>}

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
          {comments.map(c => (
            <div key={c.id} className="rounded-md border border-border px-3 py-2 text-sm">
              <div className="mb-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{c.isSuperadmin ? 'Hyperbole Digital' : 'You'}</span>
                <span>{new Date(c.createdAt).toLocaleString()}</span>
              </div>
              {c.body}
            </div>
          ))}
          {!comments.length && <p className="text-xs text-muted-foreground">No comments yet.</p>}
        </div>
        <div className="mt-2 flex gap-2">
          <Input value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a comment…" onKeyDown={e => e.key === 'Enter' && postComment()} />
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
export function RequestsTable({ requests, isSuperadmin, expandedId, onToggle, onChangeStatus, showClient = false }: {
  requests: RequestRow[]
  isSuperadmin: boolean
  expandedId: string | null
  onToggle: (id: string) => void
  onChangeStatus: (clientId: string, reqId: string, status: RequestStatus) => void
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
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        {STATUSES.filter(s => s !== r.status).map(s => (
                          <Button key={s} variant="outline" size="sm" onClick={() => onChangeStatus(r.clientId, r.id, s)}>
                            {statusLabel(s)}
                          </Button>
                        ))}
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
