import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { Link, Navigate } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertCircle, Building2, MessageSquarePlus, Mail } from 'lucide-react'
import { api } from '@/lib/api'
import type { RequestStatus } from '@/lib/api'
import { StatTile } from '@/components/stat-tile'
import { UsageBar } from '@/components/usage-bar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'
import { RequestsTable } from '@/components/requests-table'
import { useConfirm } from '@/components/confirm-dialog'

// Same status → badge-color mapping as ClientDetail.tsx's billing tab, kept
// separate since this table needs a "no subscription" (null) case too.
function subStatusVariant(status: string | null): 'success' | 'warning' | 'secondary' {
  if (status === 'active' || status === 'trialing') return 'success'
  if (status === 'past_due') return 'warning'
  return 'secondary'
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

const REQUEST_KEY = 'overview-requests'

// Same expandable-detail / comment / attach / status-change actions as the
// per-client Requests page and the client Home card — just with a Client
// column since this queue spans every tenant.
function OpenRequestsCard() {
  const { data: requests, isLoading } = useSWR(REQUEST_KEY, api.overview.requests)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  async function changeStatus(clientId: string, reqId: string, status: RequestStatus) {
    try {
      await api.overview.updateRequestStatus(clientId, reqId, status)
      mutate(REQUEST_KEY)
      mutate(['request-detail', clientId, reqId])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status')
    }
  }

  if (isLoading && !requests) return <Skeleton className="h-32 w-full" />
  if (requests && requests.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Open change requests</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <EmptyState icon={MessageSquarePlus} title="Nothing open" description="Client change requests show up here." />
        </CardContent>
      </Card>
    )
  }
  if (!requests) return null

  return (
    <div>
      <h2 className="mb-2 text-sm font-medium">Open change requests</h2>
      <RequestsTable
        requests={requests}
        isSuperadmin
        expandedId={expandedId}
        onToggle={id => setExpandedId(prev => (prev === id ? null : id))}
        onChangeStatus={changeStatus}
        showClient
      />
    </div>
  )
}

const PLATFORM_GMAIL_KEY = 'platform-gmail'

function gmailStatusVariant(status: 'ok' | 'error' | 'not_connected' | 'not_configured'): 'success' | 'destructive' | 'secondary' {
  if (status === 'ok') return 'success'
  if (status === 'error') return 'destructive'
  return 'secondary'
}

function gmailStatusLabel(status: 'ok' | 'error' | 'not_connected' | 'not_configured'): string {
  switch (status) {
    case 'ok': return 'Connected'
    case 'error': return 'Needs reconnect'
    case 'not_connected': return 'Not connected'
    case 'not_configured': return 'Not available'
  }
}

// The Gmail connection that sends every platform-level email — Clerk-relayed
// invitations, reports, change-request notifications. Independent of any
// client record on purpose: connecting or disconnecting a CLIENT's own Gmail
// (their escalation emails) never touches this, and this never touches theirs.
function PlatformEmailSenderCard() {
  const { data, isLoading } = useSWR(PLATFORM_GMAIL_KEY, api.overview.platformGmail, { refreshInterval: 30_000 })
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const confirm = useConfirm()

  async function connect() {
    setConnecting(true)
    try {
      const { url } = await api.overview.platformGmailAuthUrl()
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start Gmail connection')
    } finally {
      setConnecting(false)
    }
  }

  async function disconnect() {
    if (!(await confirm('Disconnect the platform Gmail sender? Invitations, reports, and change-request notifications will stop sending until reconnected.'))) return
    setDisconnecting(true)
    try {
      await api.overview.disconnectPlatformGmail()
      mutate(PLATFORM_GMAIL_KEY)
      toast.success('Platform Gmail disconnected')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect')
    } finally {
      setDisconnecting(false)
    }
  }

  if (isLoading || !data) return <Skeleton className="h-24 w-full" />

  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-4 pt-5">
        <div className="flex items-start gap-3">
          <Mail className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <div className="font-medium">Platform email sender <span className="font-normal text-muted-foreground">(invitations, reports, notifications)</span></div>
            <Badge variant={gmailStatusVariant(data.status)} className="mt-1.5">
              <StatusDot variant={gmailStatusVariant(data.status)} />
              {gmailStatusLabel(data.status)}{data.email ? ` — ${data.email}` : ''}
            </Badge>
            {data.connectedAt && (
              <p className="mt-1.5 text-xs text-muted-foreground">Connected {new Date(data.connectedAt).toLocaleDateString()}</p>
            )}
            {data.status === 'error' && (
              <p className="mt-1.5 max-w-md text-xs text-destructive">
                {data.error ?? 'Token is no longer valid.'} Platform email can't be sent until reconnected.
              </p>
            )}
            {!data.configured && (
              <p className="mt-1.5 text-xs text-muted-foreground">Gmail OAuth isn't configured on this deployment.</p>
            )}
          </div>
        </div>
        {data.configured && (
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" size="sm" onClick={connect} disabled={connecting}>
              {connecting ? 'Opening…' : data.status === 'not_connected' ? 'Connect' : 'Reconnect with a different account'}
            </Button>
            {data.status === 'ok' && (
              <Button variant="outline" size="sm" onClick={disconnect} disabled={disconnecting}>
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function Overview() {
  const { data: me } = useSWR('me', api.me)
  const { data: summary, error: summaryError, isLoading: summaryLoading } = useSWR(
    me?.isSuperadmin ? 'overview-summary' : null, api.overview.summary
  )
  const { data: rollups, error: rollupsError, isLoading: rollupsLoading } = useSWR(
    me?.isSuperadmin ? 'overview-clients' : null, api.overview.clients
  )

  // This page is platform-wide (superadmin only). A non-superadmin who somehow
  // lands here gets sent home rather than a scary "couldn't load data" error.
  if (me && !me.isSuperadmin) return <Navigate to="/" replace />

  const error = summaryError || rollupsError

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="text-sm text-muted-foreground">Revenue and usage across every client.</p>
      </div>

      <PlatformEmailSenderCard />

      {error && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center gap-2 pt-5 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            Couldn't load platform data.
          </CardContent>
        </Card>
      )}

      {summaryLoading && !summary && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile label="MRR" value={formatCents(summary.mrrCents)} />
          <StatTile label="Active clients" value={`${summary.activeClients} / ${summary.totalClients}`} />
          <StatTile label="Conversations this month" value={summary.conversationsThisMonth.toLocaleString()} />
          <StatTile label="Near plan cap" value={summary.clientsNearCap} />
        </div>
      )}

      {rollupsLoading && !rollups && (
        <div className="space-y-2">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      )}

      {rollups && rollups.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Building2 className="h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No clients yet.</p>
          </CardContent>
        </Card>
      )}

      {rollups && rollups.length > 0 && (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Client</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>MRR</TableHead>
                <TableHead>Usage this month</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rollups.map(r => (
                <TableRow key={r.clientId}>
                  <TableCell>
                    <Link to={`/clients/${r.slug}`} className="font-medium text-primary hover:underline">
                      {r.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.planName ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={subStatusVariant(r.subscriptionStatus)}>
                      <StatusDot variant={subStatusVariant(r.subscriptionStatus)} />
                      {r.subscriptionStatus ?? 'No subscription'}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {r.comped ? (
                      <span className="text-muted-foreground">Comped</span>
                    ) : r.mrrCents > 0 ? (
                      formatCents(r.mrrCents)
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="min-w-48">
                    <UsageBar usage={{ used: r.usage.used, cap: r.usage.cap, planName: r.planName }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <OpenRequestsCard />
    </div>
  )
}
