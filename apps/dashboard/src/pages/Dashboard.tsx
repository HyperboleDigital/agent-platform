import { useState, useEffect } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { useNavigate, Link, Navigate } from 'react-router-dom'
import { Building2, AlertCircle, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'

// Minimal fixed-overlay modal, matching the pattern used on the SEO/Local
// Presence Configure modals (no shared dialog primitive in this app yet).
function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" className="my-auto w-full max-w-lg rounded-lg border border-border bg-card shadow-xl" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

// Minimal on purpose — just enough to get a client record + id to navigate
// into. Vertical/tier/domain details get filled in from the client's own
// Tier/Config sections right after, where there's room to explain each field.
function NewClientModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [industry, setIndustry] = useState('')
  const [saving, setSaving] = useState(false)

  async function create() {
    if (!name.trim()) return
    setSaving(true)
    try {
      const client = await api.clients.upsert({ name: name.trim(), industry: industry.trim(), domain: '' })
      mutate('clients')
      toast.success('Client created')
      onClose()
      setName('')
      setIndustry('')
      navigate(`/clients/${client.slug}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create client')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose}>
      <div className="border-b border-border p-4">
        <h2 className="font-semibold">New client</h2>
        <p className="mt-1 text-sm text-muted-foreground">Creates the client record. Website, tier, and inviting their login all happen next, from the client's own page.</p>
      </div>
      <div className="grid gap-4 p-4">
        <div className="grid gap-1.5">
          <Label>Client name</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Acme Co" onKeyDown={e => { if (e.key === 'Enter') create() }} />
        </div>
        <div className="grid gap-1.5">
          <Label>Industry</Label>
          <Input value={industry} onChange={e => setIndustry(e.target.value)} placeholder="e.g. Med spa, dental, HVAC" />
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-border p-4">
        <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" onClick={create} disabled={saving || !name.trim()}>{saving ? 'Creating…' : 'Create client'}</Button>
      </div>
    </Modal>
  )
}

export default function Dashboard() {
  const { data: clients, error, isLoading } = useSWR('clients', api.clients.list)
  const { data: me } = useSWR('me', api.me)
  const [newOpen, setNewOpen] = useState(false)

  // A non-superadmin user belongs to exactly one client — their portal is the
  // client's own sections, not a one-row list. Send them straight there.
  if (me && !me.isSuperadmin && clients && clients.length === 1) {
    return <Navigate to={`/clients/${clients[0].slug}`} replace />
  }

  // Signed in, but not one of our team and not linked to any client — i.e. no
  // account has been set up for this person yet. Say that plainly instead of
  // showing an empty client list or a "couldn't load data" error.
  if (me && !me.isSuperadmin && clients && clients.length === 0) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <Building2 className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-xl font-semibold">No account set up yet</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          We don&apos;t have an account linked to your email with Hyperbole Digital yet. Accounts are set up by our team — reach out to{' '}
          <a className="text-primary hover:underline" href="mailto:hello@hyperboledigital.com">hello@hyperboledigital.com</a>{' '}
          and we&apos;ll get you connected.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Clients</h1>
          <p className="text-sm text-muted-foreground">Every client your account can access.</p>
        </div>
        {me?.isSuperadmin && (
          <Button size="sm" onClick={() => setNewOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New client
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      )}

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center gap-2 pt-5 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Couldn't reach the API, or your account isn't authorized. Check <code className="font-mono text-xs">VITE_API_URL</code> and that the API is running.
          </CardContent>
        </Card>
      )}

      {clients && clients.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Building2 className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No clients yet.</p>
            <Button size="sm" onClick={() => setNewOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Create your first client
            </Button>
          </CardContent>
        </Card>
      )}

      {clients && clients.length > 0 && (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Client</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map(c => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link to={`/clients/${c.slug}`} className="font-medium text-primary hover:underline">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.domain || '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{c.industry || '—'}</TableCell>
                  <TableCell>
                    <Badge variant={c.active ? 'success' : 'secondary'}>
                      <StatusDot variant={c.active ? 'success' : 'secondary'} />
                      {c.active ? 'Active' : 'Inactive'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {me?.isSuperadmin && <NewClientModal open={newOpen} onClose={() => setNewOpen(false)} />}
    </div>
  )
}
