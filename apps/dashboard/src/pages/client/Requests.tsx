import { useRef, useState } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { MessageSquarePlus, Plus, Paperclip } from 'lucide-react'
import { api } from '@/lib/api'
import type { RequestStatus, ChangeRequest } from '@/lib/api'
import { useClientCtx } from '@/pages/client/ClientLayout'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Label } from '@/components/ui/input'
import { EmptyState } from '@/components/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { RequestsTable, ACTIVE_STATUSES, HISTORY_STATUSES } from '@/components/requests-table'

export default function Requests() {
  const { clientId } = useClientCtx()
  const key = ['requests', clientId]
  const { data: requests, isLoading } = useSWR(key, () => api.clients.requests(clientId))
  const { data: me } = useSWR('me', api.me)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function submit() {
    if (!title.trim()) return
    setSaving(true)
    try {
      const created = await api.clients.createRequest(clientId, title.trim(), description.trim())
      if (pendingFile) {
        await api.clients.uploadRequestAttachment(clientId, created.id, pendingFile)
      }
      setTitle(''); setDescription(''); setPendingFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      mutate(key)
      toast.success('Request submitted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit request')
    } finally {
      setSaving(false)
    }
  }

  // Optimistic: the badge moves on click instead of after two round-trips
  // (the PATCH, then a refetch). optimisticData paints the new status
  // immediately and rollbackOnError puts it back if the server rejects it, so
  // the UI never lies about a change that didn't land.
  async function changeStatus(reqClientId: string, reqId: string, status: RequestStatus) {
    try {
      await mutate(
        key,
        async () => {
          await api.clients.updateRequestStatus(reqClientId, reqId, status)
          return api.clients.requests(clientId)
        },
        {
          optimisticData: (current?: ChangeRequest[]) =>
            (current ?? []).map(r => (r.id === reqId ? { ...r, status } : r)),
          rollbackOnError: true,
          revalidate: false,
        }
      )
      mutate(['request-detail', reqClientId, reqId])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status')
    }
  }

  async function remove(reqId: string, title: string) {
    if (!confirm(`Delete "${title}"? This removes the request, its history, comments and any attached files for good.`)) return
    try {
      await mutate(
        key,
        async () => {
          await api.clients.deleteRequest(clientId, reqId)
          return api.clients.requests(clientId)
        },
        {
          optimisticData: (current?: ChangeRequest[]) => (current ?? []).filter(r => r.id !== reqId),
          rollbackOnError: true,
          revalidate: false,
        }
      )
      toast.success('Request deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete request')
    }
  }

  function toggle(id: string) {
    setExpandedId(prev => (prev === id ? null : id))
  }

  const active = requests?.filter(r => ACTIVE_STATUSES.has(r.status)) ?? []
  const history = requests?.filter(r => HISTORY_STATUSES.has(r.status)) ?? []

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">Change requests</h2>
        <p className="text-sm text-muted-foreground">Ask for a website update — we'll pick it up and keep you posted here.</p>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-5">
          <div className="grid gap-1.5">
            <Label>What do you need changed?</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Update the homepage hero image" />
          </div>
          <div className="grid gap-1.5">
            <Label>Details (optional)</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Any specifics — link to the new image, exact wording, etc." />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Paperclip className="h-3.5 w-3.5" /> {pendingFile ? pendingFile.name : 'Attach a file (optional)'}
            </Button>
            <input ref={fileInputRef} type="file" className="hidden" onChange={e => setPendingFile(e.target.files?.[0] ?? null)} />
            {pendingFile && (
              <Button variant="ghost" size="sm" onClick={() => { setPendingFile(null); if (fileInputRef.current) fileInputRef.current.value = '' }}>
                Remove
              </Button>
            )}
          </div>
          <Button onClick={submit} disabled={saving || !title.trim()} className="justify-self-start">
            <Plus className="h-4 w-4" />
            {saving ? 'Submitting…' : 'Submit request'}
          </Button>
        </CardContent>
      </Card>

      {isLoading && <Skeleton className="h-40 w-full" />}

      {!isLoading && requests?.length === 0 && (
        <Card>
          <CardContent>
            <EmptyState icon={MessageSquarePlus} title="No requests yet" description="Submit your first change request above." />
          </CardContent>
        </Card>
      )}

      {!!active.length && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">Active</h3>
          <RequestsTable
            requests={active}
            isSuperadmin={!!me?.isSuperadmin}
            expandedId={expandedId}
            onToggle={toggle}
            onChangeStatus={changeStatus}
            onDelete={(_c, id, title) => remove(id, title)}
          />
        </div>
      )}

      {!!history.length && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">History</h3>
          <RequestsTable
            requests={history}
            isSuperadmin={!!me?.isSuperadmin}
            expandedId={expandedId}
            onToggle={toggle}
            onChangeStatus={changeStatus}
            onDelete={(_c, id, title) => remove(id, title)}
          />
        </div>
      )}
    </div>
  )
}
