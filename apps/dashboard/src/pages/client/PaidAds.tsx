import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Megaphone, RefreshCw, DollarSign, MousePointerClick, Target, TrendingUp } from 'lucide-react'
import { api } from '@/lib/api'
import type { AdsCampaign, AdsTotals } from '@/lib/api'
import { useClientCtx } from '@/pages/client/ClientLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'

function usd(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 === 0 ? 0 : 2 })
}
function num(n: number): string {
  return n.toLocaleString()
}
function formatDay(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export default function PaidAds() {
  const { clientId } = useClientCtx()
  const { data: me } = useSWR('me', api.me)
  const isSuperadmin = !!me?.isSuperadmin
  const { data, isLoading } = useSWR(['ads', clientId], () => api.clients.ads(clientId))
  const [snapshotting, setSnapshotting] = useState(false)

  async function snapshot() {
    setSnapshotting(true)
    try {
      await api.clients.snapshotAds(clientId)
      toast.success('Snapshot saved')
      mutate(['ads', clientId])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to snapshot')
    } finally {
      setSnapshotting(false)
    }
  }

  if (isLoading) {
    return <div className="flex flex-col gap-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-28 w-full" /><Skeleton className="h-64 w-full" /></div>
  }

  // Not connected → "connect account" state (superadmin can link the id).
  if (!data?.connected) {
    return (
      <div className="flex flex-col gap-6">
        <Header />
        <Card>
          <CardContent className="pt-6">
            {isSuperadmin
              ? <ConnectCard clientId={clientId} currentId={data?.customerId ?? ''} />
              : <EmptyState icon={Megaphone} title="Paid Ads reporting is being set up" description="Your account manager is connecting your Google Ads account. Live spend, clicks, and cost-per-lead will show up here once it's linked." />}
          </CardContent>
        </Card>
      </div>
    )
  }

  const totals = data.latest?.totals
  const campaigns = data.latest?.campaigns ?? []

  return (
    <div className="flex flex-col gap-6">
      <Header>
        <Button variant="outline" size="sm" onClick={snapshot} disabled={snapshotting}>
          <RefreshCw className="h-3.5 w-3.5" />{snapshotting ? 'Saving…' : 'Save snapshot'}
        </Button>
      </Header>

      {totals && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi icon={DollarSign} label="Ad spend (30d)" value={usd(totals.spendCents)} />
          <Kpi icon={MousePointerClick} label="Clicks" value={num(totals.clicks)} sub={`${num(totals.impressions)} impressions`} />
          <Kpi icon={Target} label="Conversions" value={num(Math.round(totals.conversions))} sub={totals.avgCpcCents ? `${usd(totals.avgCpcCents)} avg CPC` : undefined} />
          <Kpi icon={TrendingUp} label="Cost per lead" value={totals.costPerLeadCents ? usd(totals.costPerLeadCents) : '—'} />
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Spend & conversions trend</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <SpendTrend trend={data.trend} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Campaigns</CardTitle></CardHeader>
        <CardContent className="pt-0">
          {campaigns.length ? <CampaignTable campaigns={campaigns} /> : <EmptyState icon={Megaphone} title="No active campaigns" description="No campaign data in the last 30 days." />}
        </CardContent>
      </Card>

      {isSuperadmin && <OverageCard clientId={clientId} spendCents={totals?.spendCents ?? 0} />}
    </div>
  )
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold">Paid Ads</h1>
        <p className="text-sm text-muted-foreground">Your Google Ads performance — spend, clicks, and cost-per-lead. You pay Google directly; we manage the campaigns.</p>
      </div>
      {children}
    </div>
  )
}

function Kpi({ icon: Icon, label, value, sub }: { icon: typeof DollarSign; label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 pt-5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
        <div className="text-xl font-semibold">{value}</div>
        {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  )
}

function SpendTrend({ trend }: { trend: { date: string; totals: AdsTotals }[] }) {
  if (trend.length < 2) {
    return <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">Not enough history yet — save a snapshot each day to build the trend.</div>
  }
  const data = trend.map(t => ({ date: t.date, spend: Math.round(t.totals.spendCents / 100), conversions: Math.round(t.totals.conversions) }))
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="adsSpendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.3} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={formatDay} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(v: number, name: string) => name === 'spend' ? [`$${num(v)}`, 'Spend'] : [num(v), 'Conversions']}
            labelFormatter={(l: string) => formatDay(l)}
            contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }}
          />
          <Area type="monotone" dataKey="spend" stroke="var(--primary)" fill="url(#adsSpendFill)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

function CampaignTable({ campaigns }: { campaigns: AdsCampaign[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Campaign</TableHead>
          <TableHead className="text-right">Spend</TableHead>
          <TableHead className="text-right">Clicks</TableHead>
          <TableHead className="text-right">Conv.</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {campaigns.map(c => (
          <TableRow key={c.id}>
            <TableCell className="font-medium">{c.name}</TableCell>
            <TableCell className="text-right">{usd(c.spendCents)}</TableCell>
            <TableCell className="text-right">{num(c.clicks)}</TableCell>
            <TableCell className="text-right">{num(Math.round(c.conversions))}</TableCell>
            <TableCell><Badge variant={c.status === 'ENABLED' ? 'success' : 'secondary'}>{c.status.toLowerCase()}</Badge></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// Superadmin-only: link the client's Google Ads customer id.
function ConnectCard({ clientId, currentId }: { clientId: string; currentId: string }) {
  const [value, setValue] = useState(currentId)
  const [saving, setSaving] = useState(false)
  async function save() {
    setSaving(true)
    try {
      await api.clients.setAdsCustomerId(clientId, value.trim())
      toast.success('Google Ads account linked')
      mutate(['ads', clientId])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-medium">Connect the client's Google Ads account</p>
        <p className="text-sm text-muted-foreground">Enter the Google Ads customer ID (e.g. 123-456-7890) after they grant Hyperbole manager access.</p>
      </div>
      <div className="flex gap-2">
        <Input value={value} onChange={e => setValue(e.target.value)} placeholder="123-456-7890" className="max-w-xs" />
        <Button onClick={save} disabled={saving || !value.trim()}>{saving ? 'Saving…' : 'Link account'}</Button>
      </div>
    </div>
  )
}

// Superadmin-only: preview + bill the monthly % overage (the "greater of floor
// or % of spend" top-up). The floor bills automatically via the recurring
// add-on; this handles the overage as a one-off invoice item.
function OverageCard({ clientId, spendCents }: { clientId: string; spendCents: number }) {
  const period = new Date().toISOString().slice(0, 7) // YYYY-MM
  const { data: fee } = useSWR(['ads-fee', clientId, spendCents], () => api.clients.adsFeePreview(clientId, spendCents))
  const [billing, setBilling] = useState(false)

  async function bill() {
    setBilling(true)
    try {
      const res = await api.clients.billAdsOverage(clientId, spendCents, period)
      if (res.billed) toast.success(`Billed ${usd(res.overageCents)} overage for ${period}`)
      else toast.message(res.reason === 'already_billed' ? `Already billed for ${period}` : res.reason === 'no_overage' ? 'No overage — the floor covers this month' : 'Nothing to bill')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to bill overage')
    } finally {
      setBilling(false)
    }
  }

  return (
    <Card className="border-dashed">
      <CardHeader><CardTitle className="text-sm">Monthly fee reconciliation · {period} <Badge variant="outline" className="ml-1">Superadmin</Badge></CardTitle></CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0 text-sm">
        <p className="text-muted-foreground">Fee = greater of the flat floor or {fee ? `${Math.round(fee.pct * 100)}%` : '…'} of spend. The floor bills automatically; bill any overage below.</p>
        {fee && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="30d spend" value={usd(spendCents)} />
            <Stat label="Floor" value={usd(fee.floorCents)} />
            <Stat label={`% of spend`} value={usd(fee.pctCents)} />
            <Stat label="Overage to bill" value={usd(fee.overageCents)} highlight={fee.overageCents > 0} />
          </div>
        )}
        <div>
          <Button onClick={bill} disabled={billing || !fee || fee.overageCents <= 0}>
            {billing ? 'Billing…' : fee && fee.overageCents > 0 ? `Bill ${usd(fee.overageCents)} overage` : 'No overage to bill'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Uses the trailing-30-day spend as the month's figure. Confirm the spend in Google Ads before billing; each month can only be billed once.</p>
      </CardContent>
    </Card>
  )
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={highlight ? 'font-semibold text-primary' : 'font-semibold'}>{value}</div>
    </div>
  )
}
