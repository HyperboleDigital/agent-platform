import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { MessageSquarePlus, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import type { RequestStatus } from '@/lib/api'
import { useClientCtx } from '@/pages/client/ClientLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Label } from '@/components/ui/input'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { EmptyState } from '@/components/empty-state'
import { Skeleton } from '@/components/ui/skeleton'

function statusVariant(status: RequestStatus): 'success' | 'warning' | 'secondary' | 'destructive' {
  if (status === 'done') return 'success'
  if (status === 'in_progress') return 'warning'
  if (status === 'declined') return 'destructive'
  return 'secondary'
}

function statusLabel(status: RequestStatus): string {
  switch (status) {
    case 'in_progress': return 'In progress'
    case 'done': return 'Done'
    case 'declined': return 'Declined'
    default: return 'Open'
  }
}

const STATUSES: RequestStatus[] = ['open', 'in_progress', 'done', 'declined']

export default function Requests() {
  const { clientId } = useClientCtx()
  const key = ['requests', clientId]
  const { data: requests, isLoading } = useSWR(key, () => api.clients.requests(clientId))
  const { data: me } = useSWR('me', api.me)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!title.trim()) return
    setSaving(true)
    try {
      await api.clients.createRequest(clientId, title.trim(), description.trim())
      setTitle(''); setDescription('')
      mutate(key)
      toast.success('Request submitted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit request')
    } finally {
      setSaving(false)
    }
  }

  async function changeStatus(reqId: string, status: RequestStatus) {
    try {
      await api.clients.updateRequestStatus(clientId, reqId, status)
      mutate(key)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status')
    }
  }

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

      {!!requests?.length && (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Submitted</TableHead>
                {me?.isSuperadmin && <TableHead>Update</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {requests.map(r => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-medium">{r.title}</div>
                    {r.description && <div className="text-xs text-muted-foreground">{r.description}</div>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(r.status)}>
                      <StatusDot variant={statusVariant(r.status)} />
                      {statusLabel(r.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{new Date(r.createdAt).toLocaleDateString()}</TableCell>
                  {me?.isSuperadmin && (
                    <TableCell>
                      <div className="flex gap-1">
                        {STATUSES.filter(s => s !== r.status).map(s => (
                          <Button key={s} variant="outline" size="sm" onClick={() => changeStatus(r.id, s)}>
                            {statusLabel(s)}
                          </Button>
                        ))}
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
