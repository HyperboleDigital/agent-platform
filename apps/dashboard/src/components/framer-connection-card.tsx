import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { Plug, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

// Superadmin-only setup for a client's Framer publish target: project URL,
// API key (write-only — never redisplayed), collection ID, and the field
// mapping used when publishing posts.
export function FramerConnectionCard({ clientId }: { clientId: string }) {
  const key = ['framer-connection', clientId]
  const { data: connection, isLoading } = useSWR(key, () => api.clients.framerConnection(clientId))
  const [editing, setEditing] = useState(false)
  const [projectUrl, setProjectUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [collectionId, setCollectionId] = useState('')
  const [titleField, setTitleField] = useState('')
  const [bodyField, setBodyField] = useState('')
  const [slugField, setSlugField] = useState('')
  const [metaField, setMetaField] = useState('')
  const [saving, setSaving] = useState(false)
  const [fields, setFields] = useState<Array<{ id: string; name: string; type: string }> | null>(null)
  const [loadingFields, setLoadingFields] = useState(false)

  function startEdit() {
    setProjectUrl(connection?.projectUrl ?? '')
    setApiKey('')
    setCollectionId(connection?.collectionId ?? '')
    setTitleField(connection?.fieldMapping.title ?? '')
    setBodyField(connection?.fieldMapping.body ?? '')
    setSlugField(connection?.fieldMapping.slug ?? '')
    setMetaField(connection?.fieldMapping.metaDescription ?? '')
    setFields(null)
    setEditing(true)
  }

  async function loadFields() {
    setLoadingFields(true)
    try {
      const result = await api.clients.framerFields(clientId)
      setFields(result)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load collection fields — check the connection first')
    } finally {
      setLoadingFields(false)
    }
  }

  async function save() {
    if (!projectUrl.trim() || !collectionId.trim() || (!connection && !apiKey.trim())) {
      toast.error('Project URL, API key, and collection ID are required')
      return
    }
    setSaving(true)
    try {
      await api.clients.saveFramerConnection(clientId, projectUrl.trim(), apiKey.trim(), collectionId.trim(), {
        title: titleField || undefined,
        body: bodyField || undefined,
        slug: slugField || undefined,
        metaDescription: metaField || undefined
      })
      mutate(key)
      setEditing(false)
      toast.success('Framer connection saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save connection')
    } finally {
      setSaving(false)
    }
  }

  async function disconnect() {
    try {
      await api.clients.deleteFramerConnection(clientId)
      mutate(key)
      toast.success('Framer connection removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove connection')
    }
  }

  if (isLoading) return <Skeleton className="h-32 w-full" />

  if (!editing) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Plug className="h-4 w-4" /> Framer connection</CardTitle>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={startEdit}>{connection ? 'Edit' : 'Connect'}</Button>
            {connection && (
              <Button variant="ghost" size="sm" onClick={disconnect}><Trash2 className="h-3.5 w-3.5" /></Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0 text-sm text-muted-foreground">
          {connection
            ? <>Connected to <span className="font-mono text-xs">{connection.projectUrl}</span>, collection <span className="font-mono text-xs">{connection.collectionId}</span></>
            : 'Not connected — publish will fail until this is configured.'}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader><CardTitle>Framer connection</CardTitle></CardHeader>
      <CardContent className="grid gap-3 pt-0">
        <div className="grid gap-1.5">
          <Label>Project URL</Label>
          <Input value={projectUrl} onChange={e => setProjectUrl(e.target.value)} placeholder="https://framer.com/projects/Website--aabbccdd1122" />
        </div>
        <div className="grid gap-1.5">
          <Label>API key {connection && '(leave blank to keep current)'}</Label>
          <Input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="From Framer project settings → API Keys" />
        </div>
        <div className="grid gap-1.5">
          <Label>Collection ID</Label>
          <Input value={collectionId} onChange={e => setCollectionId(e.target.value)} />
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadFields} disabled={loadingFields}>
            {loadingFields ? 'Loading…' : 'Load collection fields'}
          </Button>
          {fields && <span className="text-xs text-muted-foreground">{fields.length} field(s) found</span>}
        </div>

        {fields && (
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Title field</Label>
              <FieldSelect fields={fields} value={titleField} onChange={setTitleField} />
            </div>
            <div className="grid gap-1.5">
              <Label>Body field</Label>
              <FieldSelect fields={fields} value={bodyField} onChange={setBodyField} />
            </div>
            <div className="grid gap-1.5">
              <Label>Slug field (optional)</Label>
              <FieldSelect fields={fields} value={slugField} onChange={setSlugField} />
            </div>
            <div className="grid gap-1.5">
              <Label>Meta description field (optional)</Label>
              <FieldSelect fields={fields} value={metaField} onChange={setMetaField} />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button onClick={save} disabled={saving} size="sm">{saving ? 'Saving…' : 'Save'}</Button>
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      </CardContent>
    </Card>
  )
}

function FieldSelect({ fields, value, onChange }: {
  fields: Array<{ id: string; name: string; type: string }>; value: string; onChange: (v: string) => void
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
    >
      <option value="">— none —</option>
      {fields.map(f => (
        <option key={f.id} value={f.id}>{f.name} ({f.type})</option>
      ))}
    </select>
  )
}
