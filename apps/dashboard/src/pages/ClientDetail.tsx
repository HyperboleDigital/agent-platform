import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import {
  ArrowLeft, Upload, FileText, Users, Plug, CreditCard, Settings,
  Mail, MessageSquare, CheckCircle2, XCircle
} from 'lucide-react'
import { api } from '@/lib/api'
import type { ConnectorStatus } from '@/lib/api'
import { StatTile } from '@/components/stat-tile'
import { EmptyState } from '@/components/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Label } from '@/components/ui/input'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ConversationsChart } from '@/components/charts/conversations-chart'
import { UsageBar } from '@/components/usage-bar'

export default function ClientDetail() {
  const { id = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()

  const { data: client } = useSWR(id ? ['client', id] : null, () => api.clients.get(id))
  const { data: stats } = useSWR(id ? ['stats', id] : null, () => api.clients.stats(id))

  // Billing redirect toast — the API's success/cancel URLs carry this param.
  useEffect(() => {
    const billing = searchParams.get('billing')
    if (billing === 'success') toast.success("You're now subscribed!", { description: 'Your plan is active.' })
    if (billing === 'cancelled') toast.info('Checkout cancelled', { description: 'No changes were made to your plan.' })
    if (billing) {
      searchParams.delete('billing')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pct = stats ? `${Math.round(stats.resolvedRate * 100)}%` : '—'

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> All clients
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{client?.name ?? 'Client'}</h1>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Messages this week" value={stats?.messagesThisWeek ?? '—'} />
        <StatTile label="Leads this week" value={stats?.leadsThisWeek ?? '—'} />
        <StatTile label="Open escalations" value={stats?.openEscalations ?? '—'} />
        <StatTile label="Resolved rate" value={pct} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Conversations (lifetime)" value={stats?.totalConversations ?? '—'} />
        <StatTile label="Leads captured (lifetime)" value={stats?.totalLeadsCaptured ?? '—'} />
        <StatTile label="Questions answered" value={stats?.questionsAnswered ?? '—'} />
        <StatTile label="Est. hours saved" value={stats ? `${stats.estimatedHoursSaved}h` : '—'} />
      </div>

      <ConversationsCard clientId={id} />

      <Tabs defaultValue="knowledge">
        <TabsList>
          <TabsTrigger value="knowledge"><FileText className="mr-1.5 h-3.5 w-3.5" />Knowledge</TabsTrigger>
          <TabsTrigger value="leads"><Users className="mr-1.5 h-3.5 w-3.5" />Leads</TabsTrigger>
          <TabsTrigger value="connectors"><Plug className="mr-1.5 h-3.5 w-3.5" />Connectors</TabsTrigger>
          <TabsTrigger value="billing"><CreditCard className="mr-1.5 h-3.5 w-3.5" />Billing</TabsTrigger>
          <TabsTrigger value="config"><Settings className="mr-1.5 h-3.5 w-3.5" />Config</TabsTrigger>
        </TabsList>

        <TabsContent value="knowledge"><KnowledgeTab clientId={id} /></TabsContent>
        <TabsContent value="leads"><LeadsTab clientId={id} /></TabsContent>
        <TabsContent value="connectors"><ConnectorsTab clientId={id} /></TabsContent>
        <TabsContent value="billing"><BillingTab clientId={id} /></TabsContent>
        <TabsContent value="config">{client && <ConfigTab clientId={id} client={client} />}</TabsContent>
      </Tabs>
    </div>
  )
}

function ConversationsCard({ clientId }: { clientId: string }) {
  const { data, isLoading } = useSWR(['timeseries', clientId], () => api.clients.statsTimeseries(clientId, 14))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Conversations — last 14 days</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading || !data ? <Skeleton className="h-56 w-full" /> : <ConversationsChart data={data} />}
      </CardContent>
    </Card>
  )
}

function KnowledgeTab({ clientId }: { clientId: string }) {
  const key = ['knowledge', clientId]
  const { data: docs } = useSWR(key, () => api.clients.knowledge(clientId))
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function add() {
    if (!title || !content) return
    setSaving(true)
    try {
      await api.clients.addKnowledge(clientId, title, content)
      setTitle(''); setContent('')
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
      await api.clients.uploadKnowledge(clientId, file)
      mutate(key)
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
        <CardContent className="flex flex-col gap-3 pt-5">
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              <Upload className="h-4 w-4" />
              {uploading ? 'Uploading…' : 'Upload file (PDF, Word, txt, md)'}
            </Button>
            <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt,.md" onChange={onFileChosen} className="hidden" />
          </div>

          <div className="text-xs uppercase tracking-wide text-muted-foreground">or paste text directly</div>

          <div className="grid gap-2">
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Document title" />
            <Textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Content…" rows={4} />
            <Button onClick={add} disabled={saving} className="justify-self-start">
              {saving ? 'Adding…' : 'Add document'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden p-0">
        {docs?.length ? (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Title</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map(d => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.title}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{d.url}</a> : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{new Date(d.created_at).toLocaleDateString()}</TableCell>
                </TableRow>
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

function LeadsTab({ clientId }: { clientId: string }) {
  const { data: leads } = useSWR(['leads', clientId], () => api.clients.leads(clientId))
  return (
    <Card className="overflow-hidden p-0">
      {leads?.length ? (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Intent</TableHead>
              <TableHead>When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map(l => (
              <TableRow key={l.id}>
                <TableCell className="font-medium">{l.email}</TableCell>
                <TableCell className="text-muted-foreground">{l.name || '—'}</TableCell>
                <TableCell className="text-muted-foreground">{l.intent || '—'}</TableCell>
                <TableCell className="text-muted-foreground">{new Date(l.createdAt).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <EmptyState icon={Users} title="No leads yet" description="Leads captured by your assistant show up here." />
      )}
    </Card>
  )
}

function statusVariant(status: ConnectorStatus['gmail']['status']): 'success' | 'destructive' | 'secondary' {
  if (status === 'ok') return 'success'
  if (status === 'error') return 'destructive'
  return 'secondary'
}

function statusLabel(status: ConnectorStatus['gmail']['status']): string {
  switch (status) {
    case 'ok': return 'Connected'
    case 'error': return 'Needs reconnect'
    case 'not_connected': return 'Not connected'
    case 'not_configured': return 'Not available'
  }
}

function ConnectorsTab({ clientId }: { clientId: string }) {
  const key = ['connectors', clientId]
  const { data, isLoading } = useSWR(key, () => api.clients.connectors(clientId), { refreshInterval: 30_000 })
  const [connecting, setConnecting] = useState(false)

  async function connectGmail() {
    setConnecting(true)
    try {
      const { url } = await api.clients.gmailAuthUrl(clientId)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start Gmail connection')
    } finally {
      setConnecting(false)
    }
  }

  if (isLoading || !data) {
    return <div className="grid gap-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>
  }

  return (
    <div className="grid gap-3">
      <Card>
        <CardContent className="flex items-start justify-between gap-4 pt-5">
          <div className="flex items-start gap-3">
            <Mail className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div>
              <div className="font-medium">Gmail <span className="font-normal text-muted-foreground">(sends escalation emails)</span></div>
              <Badge variant={statusVariant(data.gmail.status)} className="mt-1.5">
                <StatusDot variant={statusVariant(data.gmail.status)} />
                {statusLabel(data.gmail.status)}{data.gmail.email ? ` — ${data.gmail.email}` : ''}
              </Badge>
              {data.gmail.connectedAt && (
                <p className="mt-1.5 text-xs text-muted-foreground">Connected {new Date(data.gmail.connectedAt).toLocaleDateString()}</p>
              )}
              {data.gmail.status === 'error' && (
                <p className="mt-1.5 max-w-md text-xs text-destructive">
                  {data.gmail.error ?? 'Token is no longer valid.'} Escalation emails can't be sent until reconnected (Slack still works).
                </p>
              )}
              {!data.gmail.configured && (
                <p className="mt-1.5 text-xs text-muted-foreground">Gmail OAuth isn't configured on this deployment — escalations go to Slack only.</p>
              )}
            </div>
          </div>
          {data.gmail.configured && data.gmail.status !== 'ok' && (
            <Button variant="secondary" size="sm" onClick={connectGmail} disabled={connecting}>
              {connecting ? 'Opening…' : data.gmail.status === 'not_connected' ? 'Connect' : 'Reconnect'}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center gap-3 pt-5">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="font-medium">Slack escalations</div>
            <Badge variant={data.slack.configured ? 'success' : 'secondary'} className="mt-1.5">
              <StatusDot variant={data.slack.configured ? 'success' : 'secondary'} />
              {data.slack.configured ? 'Configured' : 'Not configured'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center gap-3 pt-5">
          <Plug className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="font-medium">Calendly</div>
            <Badge variant={data.calendly.configured ? 'success' : 'secondary'} className="mt-1.5">
              <StatusDot variant={data.calendly.configured ? 'success' : 'secondary'} />
              {data.calendly.configured ? 'Configured' : 'Not configured — set a link in Config'}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due'])

function subStatusVariant(status: string): 'success' | 'warning' | 'secondary' {
  if (status === 'active' || status === 'trialing') return 'success'
  if (status === 'past_due') return 'warning'
  return 'secondary'
}

function UsageCard({ clientId }: { clientId: string }) {
  const { data: usage } = useSWR(['usage', clientId], () => api.clients.statsUsage(clientId))
  return (
    <Card>
      <CardContent className="pt-5">
        {usage ? <UsageBar usage={usage} /> : <Skeleton className="h-6 w-full" />}
      </CardContent>
    </Card>
  )
}

function BillingTab({ clientId }: { clientId: string }) {
  const { data: plans } = useSWR('plans', () => api.billing.plans())
  const { data, isLoading } = useSWR(['billing', clientId], () => api.billing.get(clientId), { refreshInterval: 30_000 })
  const [busyPlan, setBusyPlan] = useState<string | null>(null)
  const [openingPortal, setOpeningPortal] = useState(false)

  async function subscribe(priceId: string) {
    setBusyPlan(priceId)
    try {
      const { url } = await api.billing.checkout(clientId, priceId)
      window.location.href = url
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start checkout')
      setBusyPlan(null)
    }
  }

  async function openPortal() {
    setOpeningPortal(true)
    try {
      const { url } = await api.billing.portal(clientId)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open billing portal')
    } finally {
      setOpeningPortal(false)
    }
  }

  if (isLoading || !plans) return <Skeleton className="h-24 w-full" />

  const sub = data?.subscription
  const isActive = sub && ACTIVE_STATUSES.has(sub.status)

  return (
    <div className="grid gap-3">
      <Card>
        <CardContent className="flex items-start justify-between gap-4 pt-5">
          <div className="flex items-start gap-3">
            <CreditCard className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div>
              <div className="font-medium">Current plan</div>
              {sub ? (
                <>
                  <Badge variant={subStatusVariant(sub.status)} className="mt-1.5">
                    <StatusDot variant={subStatusVariant(sub.status)} />
                    {data?.plan?.name ?? 'Unknown plan'} — {sub.status}
                  </Badge>
                  {sub.currentPeriodEnd && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {sub.status === 'active' ? 'Renews' : 'Ends'} {new Date(sub.currentPeriodEnd).toLocaleDateString()}
                    </p>
                  )}
                  {sub.stripeCustomerId === 'comped' && (
                    <p className="mt-1.5 text-xs text-muted-foreground">Comped by admin — no card on file.</p>
                  )}
                </>
              ) : (
                <Badge variant="secondary" className="mt-1.5"><StatusDot variant="secondary" />No active subscription</Badge>
              )}
            </div>
          </div>
          {sub && sub.stripeCustomerId !== 'comped' && (
            <Button variant="secondary" size="sm" onClick={openPortal} disabled={openingPortal}>
              {openingPortal ? 'Opening…' : 'Manage billing'}
            </Button>
          )}
        </CardContent>
      </Card>

      {isActive && <UsageCard clientId={clientId} />}

      {!isActive && (
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map(p => (
            <Card key={p.priceId}>
              <CardContent className="pt-5">
                <div className="font-medium">{p.name}</div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">
                  ${(p.monthlyPriceCents / 100).toFixed(0)}<span className="text-sm font-normal text-muted-foreground">/mo</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Up to {p.conversationCap.toLocaleString()} conversations/mo</p>
                <Button onClick={() => subscribe(p.priceId)} disabled={busyPlan === p.priceId} className="mt-3 w-full">
                  {busyPlan === p.priceId ? 'Redirecting…' : `Subscribe to ${p.name}`}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function ConfigTab({ clientId, client }: { clientId: string; client: import('@agent-platform/shared').Client }) {
  const cfg = client.agentConfig ?? {}
  const [systemPromptExtra, setExtra] = useState(cfg.systemPromptExtra ?? '')
  const [calendlyLink, setCalendly] = useState(cfg.calendlyLink ?? '')
  const [escalationEmail, setEscalationEmail] = useState(cfg.escalationEmail ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await api.clients.upsert({ id: client.id, agentConfig: { ...cfg, systemPromptExtra, calendlyLink, escalationEmail } })
      mutate(['client', clientId])
      toast.success('Config saved', { icon: <CheckCircle2 className="h-4 w-4" /> })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save', { icon: <XCircle className="h-4 w-4" /> })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="grid gap-4 pt-5">
        <div className="grid gap-1.5">
          <Label>Extra system prompt</Label>
          <Textarea value={systemPromptExtra} onChange={e => setExtra(e.target.value)} rows={4} />
        </div>
        <div className="grid gap-1.5">
          <Label>Calendly link</Label>
          <Input value={calendlyLink} onChange={e => setCalendly(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>Escalation email (where "get a human" requests are sent)</Label>
          <Input value={escalationEmail} onChange={e => setEscalationEmail(e.target.value)} placeholder="support@yourcompany.com" />
        </div>
        <Button onClick={save} disabled={saving} className="justify-self-start">
          {saving ? 'Saving…' : 'Save config'}
        </Button>
      </CardContent>
    </Card>
  )
}
