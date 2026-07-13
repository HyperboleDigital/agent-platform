import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { AlertCircle, Building2 } from 'lucide-react'
import { api } from '@/lib/api'
import { StatTile } from '@/components/stat-tile'
import { UsageBar } from '@/components/usage-bar'
import { Card, CardContent } from '@/components/ui/card'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'

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

export default function Overview() {
  const { data: summary, error: summaryError, isLoading: summaryLoading } = useSWR('overview-summary', api.overview.summary)
  const { data: rollups, error: rollupsError, isLoading: rollupsLoading } = useSWR('overview-clients', api.overview.clients)

  const error = summaryError || rollupsError

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="text-sm text-muted-foreground">Revenue and usage across every client.</p>
      </div>

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
                <TableHead>Usage this month</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rollups.map(r => (
                <TableRow key={r.clientId}>
                  <TableCell>
                    <Link to={`/clients/${r.clientId}`} className="font-medium text-primary hover:underline">
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
                  <TableCell className="min-w-48">
                    <UsageBar usage={{ used: r.usage.used, cap: r.usage.cap, planName: r.planName }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
