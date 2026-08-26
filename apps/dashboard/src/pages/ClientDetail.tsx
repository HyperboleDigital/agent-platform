import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams, useNavigate } from 'react-router-dom'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import {
  Users, Plug, CreditCard, Mail, MessageSquare, MessageSquarePlus,
  CheckCircle2, XCircle, Undo2, Trash2, Layers, Clock, AlertTriangle, Link2, Bot, Lock, Upload, Building2
} from 'lucide-react'
import { normalizeDomain, isPublicHost, type LeadStatus, type HostingOwner } from '@agent-platform/shared'
import { api } from '@/lib/api'
import type { ConnectorStatus, RequestStatus, TierInfo, TierFeature, ServiceKey, ClientLineItem, LineItemCadence } from '@/lib/api'
import { useEntitlements } from '@/hooks/use-entitlements'
import { useClientCtx } from '@/pages/client/ClientLayout'
import { StatTile } from '@/components/stat-tile'
import { EmptyState } from '@/components/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Label } from '@/components/ui/input'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { ConversationsChart } from '@/components/charts/conversations-chart'
import { UsageBar } from '@/components/usage-bar'
import { useConfirm } from '@/components/confirm-dialog'
import { SiteHealthCard } from '@/components/site-health-card'
import { SiteBaselineCard } from '@/components/site-baseline-card'
import { ContactButton } from '@/components/contact-button'
import { RequestsTable } from '@/components/requests-table'
import { EmailListField } from '@/components/email-list-field'
import { MonthSummaryCard } from '@/components/month-summary'

// ── Section wrappers ─────────────────────────────────────────────────────────
// Each maps a /clients/:id/<section> route to the section component below,
// pulling clientId/client from the layout's outlet context.

export function ClientHome() {
  const { clientId: id, client } = useClientCtx()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: stats } = useSWR(id ? ['stats', id] : null, () => api.clients.stats(id))
  const { entitlements } = useEntitlements(id)
  const chatEntitled = entitlements?.services.chat?.entitled ?? false
  const seoEntitled = entitlements?.services.seo?.entitled ?? false
  const { data: me } = useSWR('me', api.me)

  // Billing redirect toast — the API's success/cancel URLs land here.
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

  // Ordered by what a client actually cares about first: is my plan active
  // (the ClientLayout gate already blocks a fully inactive account, but this
  // is the visible confirmation — and it's the one thing superadmin needs to
  // spot at a glance across every client), is the site healthy, is SEO/
  // visibility improving, what needs my attention (requests), how's lead
  // flow, and — last, since it's the mechanism not the outcome — how's the
  // chat assistant doing.
  return (
    <div className="flex flex-col gap-6">
      <PlanStatusCard clientId={id} hosting={client?.hosting} />
      {/* The retainer-justification view (handoff #3 §3) — the default landing
          card for SEO+GEO clients: what happened this month, led by wins. */}
      {seoEntitled && <MonthSummaryCard clientId={id} isSuperadmin={!!me?.isSuperadmin} />}
      {/* No Site Health on client-hosted sites — we can't act on uptime for a
          site we don't host, and a red badge we can't fix is worse than
          showing nothing. */}
      {client?.hosting !== 'client' && <SiteHealthCard clientId={id} domain={client?.domain} />}
      <SiteBaselineCard clientId={id} domain={client?.domain} />
      <SeoVisibilitySummaryCard clientId={id} />
      <RequestsCard clientId={id} />

      <div>
        <h2 className="mb-2 text-lg font-semibold">Leads</h2>
        {!stats ? (
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-[72px] w-full" /><Skeleton className="h-[72px] w-full" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Leads this week" value={stats.leadsThisWeek} />
            <StatTile label="Leads captured (lifetime)" value={stats.totalLeadsCaptured} />
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-lg font-semibold">Chat assistant</h2>
        {!chatEntitled ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-1.5 py-8 text-center">
              <Lock className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">Chat Assistant is locked</p>
              <p className="text-sm text-muted-foreground">It&apos;s included on Growth plans — <Link to="billing" className="text-primary hover:underline">see your plan</Link> to add it.</p>
            </CardContent>
          </Card>
        ) : !stats ? (
          <Skeleton className="h-24 w-full" />
        ) : stats.totalConversations === 0 ? (
          // No conversation has ever happened — 6 zero-tiles + an empty chart
          // is noise, not information. One line says the same thing.
          <Card>
            <CardContent className="flex flex-col items-center gap-1.5 py-8 text-center">
              <Bot className="h-6 w-6 text-muted-foreground" />
              <p className="text-sm font-medium">No conversations yet</p>
              <p className="text-sm text-muted-foreground">Stats will show up here once visitors start chatting.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <StatTile
                label="Messages this week"
                value={stats.messagesThisWeek}
                info="Individual visitor messages the assistant answered in the last 7 days. One conversation usually contains several messages, so this runs higher than the conversation count."
              />
              <StatTile
                label="Open escalations"
                value={stats.openEscalations}
                info="Conversations handed off to a human that haven't been closed yet."
              />
              <StatTile
                label="Resolved rate"
                value={pct}
                info="Share of this week's messages the assistant answered fully on its own, with no human handoff."
              />
              <StatTile
                label="Conversations (lifetime)"
                value={stats.totalConversations}
                info="Total chat sessions since the assistant launched. One conversation is one visitor's session, however many messages it takes."
              />
              <StatTile
                label="Questions answered"
                value={stats.questionsAnswered}
                info="Conversations where the assistant fully answered a visitor's question from your knowledge base."
              />
              <StatTile
                label="Est. hours saved"
                value={`${stats.estimatedHoursSaved}h`}
                info="A rough estimate: about 6 minutes of staff time for each conversation the assistant resolved on its own. An approximation, not a measurement."
              />
            </div>
            <ConversationsCard clientId={id} />
          </div>
        )}
      </div>
    </div>
  )
}

// Compact SEO + AI Visibility summary for Home — on-page score, target-keyword
// progress, and AI-mention rate at a glance, each linking to the full SEO page
// for detail. Read-only; no on-demand checks fire from here.
function SeoVisibilitySummaryCard({ clientId }: { clientId: string }) {
  // Only fetch (and only render) when the client is actually entitled to SEO —
  // otherwise these calls 403 and the card is meaningless.
  const { entitlements } = useEntitlements(clientId)
  const seoEntitled = entitlements?.services.seo?.entitled ?? false

  const { data: crawl } = useSWR(seoEntitled ? ['seo-crawl', clientId] : null, () => api.clients.latestCrawl(clientId))
  const { data: kwData } = useSWR(seoEntitled ? ['target-keywords', clientId] : null, () => api.clients.targetKeywords(clientId))
  const { data: visData } = useSWR(seoEntitled ? ['visibility-runs', clientId] : null, () => api.clients.visibilityRuns(clientId, 30))

  if (!seoEntitled) return null

  const keywords = kwData?.keywords ?? []
  const rankedKeywords = keywords.filter(k => k.latestRank != null)
  const top10 = rankedKeywords.filter(k => (k.latestRank ?? 999) <= 10).length

  const latestMentionRate = visData?.trend?.length ? visData.trend[visData.trend.length - 1].mentionRate : null

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>SEO &amp; AI Visibility</CardTitle>
        <Link to="seo" className="text-sm text-primary hover:underline">View all</Link>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 pt-0 sm:grid-cols-3">
        <StatTile
          label="On-page health"
          value={crawl?.onpageScore != null ? `${Math.round(crawl.onpageScore)}/100` : 'Not run yet'}
        />
        <StatTile
          label="Target keywords in top 10"
          value={keywords.length ? `${top10} / ${keywords.length}` : 'None tracked'}
        />
        <StatTile
          label="AI mention rate (30d)"
          value={latestMentionRate != null ? `${Math.round(latestMentionRate * 100)}%` : 'No checks yet'}
        />
      </CardContent>
    </Card>
  )
}

// Visible confirmation of subscription status. ClientLayout's gate already
// blocks a fully-inactive account from reaching Home at all, so a client will
// normally only ever see the "Active" state here — this is the proof-of-life,
// not the enforcement. Superadmin sees it too, including the inactive state,
// since they can view a client's Home regardless of billing status.
// Tier bullets that don't apply to this client are hidden outright, not shown
// as unavailable: hosting promises when the client hosts their own site
// (clients.hosting = 'client'), and the assistant-stays-live bullet when
// there's no assistant to keep live.
function applicableFeatures(features: TierFeature[] | undefined, hosting: string | undefined, chatEntitled: boolean): TierFeature[] {
  return (features ?? []).filter(f => (!f.hostedOnly || hosting !== 'client') && (!f.chatOnly || chatEntitled))
}

function PlanStatusCard({ clientId, hosting }: { clientId: string; hosting?: string }) {
  const { entitlements, isLoading } = useEntitlements(clientId)
  const { data: tiers } = useSWR('billing-tiers', api.billing.tiers)
  const { data: billing } = useSWR(['billing', clientId], () => api.billing.get(clientId))
  const { data: me } = useSWR('me', api.me)
  const isAdmin = !!me?.isSuperadmin

  if (isLoading || !entitlements) return <Skeleton className="h-20 w-full" />

  // Only resolve the tier when the plan is actually active. planKey is derived
  // from whatever subscription row exists, including a canceled one, so without
  // this gate a client who cancelled still saw their old plan's name and price
  // sitting next to a "Not active" badge — reading as though they're still on
  // (and being charged for) a plan they ended.
  const tier = entitlements.active ? tiers?.find(t => t.key === entitlements.planKey) ?? null : null
  const priceLabel = tier ? `$${(tier.monthlyPriceCents / 100).toLocaleString(undefined, { minimumFractionDigits: 0 })}/mo` : null
  const renewsAt = billing?.subscription?.currentPeriodEnd
  const chatEntitled = entitlements.services.chat?.entitled ?? false
  const included = applicableFeatures(tier?.features, hosting, chatEntitled).filter(f => f.built).slice(0, 4)

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={entitlements.active ? 'success' : 'destructive'}>
              <StatusDot variant={entitlements.active ? 'success' : 'destructive'} />
              {entitlements.active ? 'Plan active' : 'Not active'}
            </Badge>
            {tier && <span className="text-sm font-medium">{tier.name}</span>}
            {priceLabel && <span className="text-sm text-muted-foreground">{priceLabel}</span>}
          </div>
          <div className="flex items-center gap-3">
            {entitlements.active && renewsAt && (
              <span className="text-xs text-muted-foreground">Renews {new Date(renewsAt).toLocaleDateString()}</span>
            )}
            {(isAdmin || entitlements.active) && (
              <Link to="billing" className="text-sm text-primary hover:underline">
                {entitlements.active ? 'Manage plan' : 'View billing'}
              </Link>
            )}
          </div>
        </div>
        {entitlements.active && included.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {included.map(f => (
              <span key={f.text} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{f.text}</span>
            ))}
          </div>
        )}
        {!entitlements.active && (
          isAdmin ? (
            <p className="text-sm text-muted-foreground">Not active yet. Open billing to assign a tier and get them a payment link.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-muted-foreground">Not sure which plan is right for you?</p>
              <ContactButton clientId={clientId} variant="secondary" label="Contact Hyperbole to pick a plan" defaultTopic="Choosing or changing my plan" />
            </div>
          )
        )}
      </CardContent>
    </Card>
  )
}

function RequestsCard({ clientId }: { clientId: string }) {
  const key = ['requests', clientId]
  const { data: requests, isLoading } = useSWR(key, () => api.clients.requests(clientId))
  const { data: me } = useSWR('me', api.me)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const openCount = requests?.filter(r => r.status === 'open' || r.status === 'in_progress').length ?? 0

  async function changeStatus(reqClientId: string, reqId: string, status: RequestStatus) {
    try {
      await api.clients.updateRequestStatus(reqClientId, reqId, status)
      mutate(key)
      mutate(['request-detail', reqClientId, reqId])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status')
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Change requests</CardTitle>
        <Link to="requests" className="text-sm text-primary hover:underline">View all</Link>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !requests?.length ? (
          <EmptyState icon={MessageSquarePlus} title="No requests yet" description="Ask for a website update from the Requests section." />
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">{openCount} open</p>
            <RequestsTable
              requests={requests.slice(0, 3)}
              isSuperadmin={!!me?.isSuperadmin}
              expandedId={expandedId}
              onToggle={id => setExpandedId(prev => (prev === id ? null : id))}
              onChangeStatus={changeStatus}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function LeadsSection() {
  const { clientId } = useClientCtx()
  return <LeadsTab clientId={clientId} />
}

export function BillingSection() {
  const { clientId, client } = useClientCtx()
  const { data: me } = useSWR('me', api.me)

  // Clients never see pricing-sheet tiers, the tier picker, payment links, or
  // raw Stripe subscription internals. They see the plan they're on (or a
  // prompt to reach out), and nothing they could self-serve into.
  if (me && !me.isSuperadmin) {
    return client ? <ClientPlanView client={client} /> : <Skeleton className="h-24 w-full" />
  }

  return (
    <div className="flex flex-col gap-3">
      {client ? <TierCard clientId={clientId} client={client} /> : <Skeleton className="h-24 w-full" />}
      {client && <LineItemsCard clientId={clientId} client={client} />}
      <BillingTab clientId={clientId} client={client} />
    </div>
  )
}

// The client-facing billing view: just the plan they're on and what it
// includes, or a nudge to reach out if they're not on one yet. No prices to
// pick, no Stripe internals, no payment links.
function ClientPlanView({ client }: { client: import('@agent-platform/shared').Client }) {
  const { data: tiers } = useSWR('tiers', () => api.billing.tiers())
  const { entitlements } = useEntitlements(client.id)
  const assigned = tiers?.find(t => t.key === client.tierKey) ?? null
  const chatEntitled = entitlements?.services.chat?.entitled ?? false

  if (!tiers) return <Skeleton className="h-24 w-full" />

  if (!assigned) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your plan</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <EmptyState
            icon={CreditCard}
            title="You're not on a plan yet"
            description="We'll get you set up with the right plan."
            action={<ContactButton clientId={client.id} label="Contact Hyperbole to get started" defaultTopic="Choosing or changing my plan" />}
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Layers className="h-4 w-4 text-primary" /> Your plan</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="flex items-baseline gap-2">
          <span className="text-base font-semibold">{assigned.name}</span>
          <span className="text-sm tabular-nums text-muted-foreground">${(assigned.monthlyPriceCents / 100).toFixed(0)}/mo</span>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Included in your plan</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {applicableFeatures(assigned.features, client.hosting, chatEntitled).map(f => (
              <li key={f.text} className="flex items-start gap-2 text-sm">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted-foreground">Questions about your plan? Use <span className="font-medium text-foreground">Contact Hyperbole</span> at the top.</p>
      </CardContent>
    </Card>
  )
}

export function ConfigSection() {
  const { clientId, client } = useClientCtx()
  const { data: me } = useSWR('me', api.me)
  return (
    <div className="flex flex-col gap-6">
      {me?.isSuperadmin && client && <InviteCard clientId={clientId} client={client} />}
      {client ? <ConfigTab clientId={clientId} client={client} /> : <Skeleton className="h-40 w-full" />}
      <NotificationSettingsCard clientId={clientId} />
      <div>
        <h2 className="mb-1 text-lg font-semibold">Connectors</h2>
        <p className="mb-3 text-sm text-muted-foreground">Gmail, Slack, and Calendly integrations for this client.</p>
        {client ? <ConnectorsTab clientId={clientId} client={client} /> : <Skeleton className="h-40 w-full" />}
      </div>
      {me?.isSuperadmin && client && <DangerZoneCard client={client} />}
    </div>
  )
}

// Superadmin-only permanent delete. Requires typing the client's exact name to
// confirm — the same guard the API enforces — so a stray click can't wipe a
// tenant and all its data.
function DangerZoneCard({ client }: { client: import('@agent-platform/shared').Client }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  async function remove() {
    setDeleting(true)
    try {
      await api.clients.remove(client.id, confirmText.trim())
      mutate('clients')
      toast.success(`${client.name} deleted`)
      navigate('/')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete client')
      setDeleting(false)
    }
  }

  return (
    <Card className="border-destructive/30">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <p className="text-sm text-muted-foreground">
          Permanently delete <span className="font-medium text-foreground">{client.name}</span> and everything associated with it — leads, requests, audits, subscriptions, and their login. This cannot be undone.
        </p>
        {!open ? (
          <Button variant="outline" size="sm" className="self-start border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setOpen(true)}>
            <Trash2 className="h-3.5 w-3.5" /> Delete client
          </Button>
        ) : (
          <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm">
              Type <span className="font-mono font-semibold">{client.name}</span> to confirm permanent deletion:
            </p>
            <Input value={confirmText} onChange={e => setConfirmText(e.target.value)} placeholder={client.name} disabled={deleting} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setOpen(false); setConfirmText('') }} disabled={deleting}>Cancel</Button>
              <Button
                size="sm"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={remove}
                disabled={deleting || confirmText.trim() !== client.name}
              >
                {deleting ? 'Deleting…' : 'Delete permanently'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Sends the client's real login invitation — a Clerk-hosted email where they
// set their own password. Creates the client's Clerk Organization on first use
// if it doesn't have one yet (that Organization IS the tenant boundary; see
// authz.canAccessClient). Deliberately requires typing the email fresh each
// time and an explicit click — this sends a real email, never automatic.
function InviteCard({ clientId, client }: { clientId: string; client: import('@agent-platform/shared').Client }) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [lastSentTo, setLastSentTo] = useState<string | null>(null)

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const validEmail = EMAIL_RE.test(email.trim())

  async function send() {
    setSending(true)
    try {
      await api.clients.invite(clientId, email.trim())
      mutate(['client', clientId])
      setLastSentTo(email.trim())
      setEmail('')
      setConfirming(false)
      toast.success(`Invitation sent to ${email.trim()}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send invite')
    } finally {
      setSending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Client login</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 pt-0">
        <p className="text-sm text-muted-foreground">
          {client.clerkOrgId
            ? "This client's organization is set up. Invite another teammate below — this won't resend to people already invited."
            : "No login access yet. Sending an invite below creates this client's account automatically."}
        </p>
        <div className="flex items-end gap-2">
          <div className="grid flex-1 gap-1.5">
            <Label>Client's email</Label>
            <Input
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="owner@example.com"
              type="email"
              disabled={confirming || sending}
            />
          </div>
          {!confirming && (
            <Button size="sm" onClick={() => setConfirming(true)} disabled={!validEmail}>
              Send invite
            </Button>
          )}
        </div>

        {/* In-UI confirmation (no browser alert) — sending a real email is a
            deliberate, confirmed action. */}
        {confirming && (
          <div className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3">
            <p className="text-sm">
              Send a real login invitation email to <span className="font-medium">{email.trim()}</span>? They'll get a link to set a password and access this client's dashboard.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={sending}>Cancel</Button>
              <Button size="sm" onClick={send} disabled={sending}>{sending ? 'Sending…' : 'Yes, send invite'}</Button>
            </div>
          </div>
        )}

        {lastSentTo && !confirming && (
          <p className="text-xs text-success">
            Invitation sent to {lastSentTo}. Clerk emails them a link to set their password — check back once they've accepted.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// 7 days, matching the Chat Assistant → Insights page's shortest range and the
// "… this week" tiles directly above it. Home and Insights must agree on the
// same day: a 14-day window here next to a 7-day one there invited exactly the
// "why does Aug 20 say 3 in one place and 2 in the other?" question.
function ConversationsCard({ clientId }: { clientId: string }) {
  const { data, isLoading } = useSWR(['timeseries', clientId], () => api.clients.statsTimeseries(clientId, 7))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Conversations — last 7 days</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading || !data ? <Skeleton className="h-56 w-full" /> : <ConversationsChart data={data} />}
      </CardContent>
    </Card>
  )
}

function LeadsTab({ clientId }: { clientId: string }) {
  const key = ['leads', clientId]
  const { data: leads } = useSWR(key, () => api.clients.leads(clientId))
  const { data: me } = useSWR('me', api.me)
  const confirm = useConfirm()

  async function setStatus(leadId: string, status: LeadStatus) {
    try {
      await api.clients.updateLeadStatus(clientId, leadId, status)
      mutate(key)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update lead')
    }
  }

  async function remove(leadId: string) {
    if (!(await confirm('Delete this lead? This can\'t be undone.'))) return
    try {
      await api.clients.deleteLead(clientId, leadId)
      mutate(key)
      toast.success('Lead deleted')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete lead')
    }
  }

  return (
    <Card className="overflow-hidden p-0">
      {leads?.length ? (
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Division</TableHead>
              <TableHead>Intent</TableHead>
              <TableHead>When</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map(l => (
              <TableRow key={l.id} className={l.status === 'followed_up' ? 'opacity-60' : undefined}>
                <TableCell className="font-medium">{l.email}</TableCell>
                <TableCell className="text-muted-foreground">{l.name || '—'}</TableCell>
                <TableCell className="text-muted-foreground">{l.company || '—'}</TableCell>
                <TableCell className="text-muted-foreground">{l.phone || '—'}</TableCell>
                <TableCell className="text-muted-foreground">{l.division || '—'}</TableCell>
                <TableCell className="text-muted-foreground">{l.intent || '—'}</TableCell>
                <TableCell className="text-muted-foreground">{new Date(l.createdAt).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Badge variant={l.status === 'followed_up' ? 'success' : 'secondary'}>
                    <StatusDot variant={l.status === 'followed_up' ? 'success' : 'secondary'} />
                    {l.status === 'followed_up' ? 'Followed up' : 'New'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {l.status === 'followed_up' ? (
                      <Button variant="ghost" size="sm" onClick={() => setStatus(l.id, 'new')} title="Mark as new again">
                        <Undo2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => setStatus(l.id, 'followed_up')}>
                        <CheckCircle2 className="h-3.5 w-3.5" /> Followed up
                      </Button>
                    )}
                    {me?.isSuperadmin && (
                      <Button variant="ghost" size="sm" onClick={() => remove(l.id)} title="Delete lead">
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
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

function ConnectorsTab({ clientId, client }: { clientId: string; client: import('@agent-platform/shared').Client }) {
  const key = ['connectors', clientId]
  const { data, isLoading } = useSWR(key, () => api.clients.connectors(clientId), { refreshInterval: 30_000 })
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const confirm = useConfirm()

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

  async function disconnectGmail() {
    if (!(await confirm('Disconnect Gmail? Escalation emails will stop sending until you reconnect (Slack still works).'))) return
    setDisconnecting(true)
    try {
      await api.clients.disconnectGmail(clientId)
      mutate(key)
      toast.success('Gmail disconnected')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect Gmail')
    } finally {
      setDisconnecting(false)
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
              {data.gmail.status === 'not_connected' && (
                <p className="mt-1.5 max-w-md text-xs text-muted-foreground">
                  Escalation emails still send — via Hyperbole's platform sender, using this client's own branding — until this is connected.
                  Connect to send from their own address instead.
                </p>
              )}
              {data.gmail.status === 'error' && (
                <p className="mt-1.5 max-w-md text-xs text-warning">
                  {data.gmail.error ?? 'Token is no longer valid.'} Escalation emails are falling back to Hyperbole's platform sender until reconnected.
                </p>
              )}
              {!data.gmail.configured && (
                <p className="mt-1.5 text-xs text-muted-foreground">Gmail OAuth isn't configured on this deployment — escalations go to Slack only.</p>
              )}
            </div>
          </div>
          {data.gmail.configured && (
            <div className="flex shrink-0 gap-2">
              <Button variant="secondary" size="sm" onClick={connectGmail} disabled={connecting}>
                {connecting ? 'Opening…' : data.gmail.status === 'not_connected' ? 'Connect' : 'Reconnect with a different account'}
              </Button>
              {data.gmail.status === 'ok' && (
                <Button variant="outline" size="sm" onClick={disconnectGmail} disabled={disconnecting}>
                  {disconnecting ? 'Disconnecting…' : 'Disconnect'}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <SlackConnectorCard clientId={clientId} client={client} configured={data.slack.configured} />
      <CalendlyConnectorCard clientId={clientId} client={client} configured={data.calendly.configured} />
    </div>
  )
}

function SlackConnectorCard({ clientId, client, configured }: {
  clientId: string; client: import('@agent-platform/shared').Client; configured: boolean
}) {
  const cfg = client.agentConfig ?? {}
  const [webhook, setWebhook] = useState(cfg.slackWebhook ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await api.clients.upsert({ id: clientId, agentConfig: { ...cfg, slackWebhook: webhook || undefined } })
      mutate(['client', clientId])
      mutate(['connectors', clientId])
      toast.success('Slack webhook saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        <div className="flex items-center gap-3">
          <MessageSquare className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="font-medium">Slack escalations</div>
            <Badge variant={configured ? 'success' : 'secondary'} className="mt-1.5">
              <StatusDot variant={configured ? 'success' : 'secondary'} />
              {configured ? 'Configured' : 'Not configured'}
            </Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Input value={webhook} onChange={e => setWebhook(e.target.value)} placeholder="https://hooks.slack.com/services/…" />
          <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </CardContent>
    </Card>
  )
}

function CalendlyConnectorCard({ clientId, client, configured }: {
  clientId: string; client: import('@agent-platform/shared').Client; configured: boolean
}) {
  const cfg = client.agentConfig ?? {}
  const [link, setLink] = useState(cfg.calendlyLink ?? '')
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      await api.clients.upsert({ id: clientId, agentConfig: { ...cfg, calendlyLink: link || undefined } })
      mutate(['client', clientId])
      mutate(['connectors', clientId])
      toast.success('Calendly link saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-5">
        <div className="flex items-center gap-3">
          <Plug className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="font-medium">Calendly</div>
            <Badge variant={configured ? 'success' : 'secondary'} className="mt-1.5">
              <StatusDot variant={configured ? 'success' : 'secondary'} />
              {configured ? 'Configured' : 'Not configured'}
            </Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Input value={link} onChange={e => setLink(e.target.value)} placeholder="https://calendly.com/your-link" />
          <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </CardContent>
    </Card>
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

// The pricing-sheet tier (one ladder: Care / SEO / Growth) — see lib/tiers.ts
// on the API side. The tier is a STARTING TEMPLATE for a deal: per-client
// customization happens through the custom line items below it. Shows the
// client exactly what their tier promises, distinguishing bullets the
// dashboard actually delivers today from ones still on the roadmap.
function TierCard({ clientId, client }: { clientId: string; client: import('@agent-platform/shared').Client }) {
  const { data: tiers } = useSWR('tiers', () => api.billing.tiers())
  const { data: me } = useSWR('me', api.me)
  const { entitlements } = useEntitlements(clientId)
  const [tierKey, setTierKey] = useState(client.tierKey ?? '')
  const [saving, setSaving] = useState(false)
  const [linking, setLinking] = useState(false)

  const assigned = tiers?.find(t => t.key === client.tierKey) ?? null
  const chatEntitled = entitlements?.services.chat?.entitled ?? false

  async function copyPaymentLink() {
    if (!tierKey) return
    setLinking(true)
    try {
      const { url } = await api.billing.tierLink(client.id, tierKey)
      await navigator.clipboard.writeText(url)
      toast.success('Payment link copied — send it to the client to switch their plan', { icon: <CheckCircle2 className="h-4 w-4" /> })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create payment link', { icon: <XCircle className="h-4 w-4" /> })
    } finally {
      setLinking(false)
    }
  }

  async function save() {
    setSaving(true)
    try {
      await api.clients.upsert({ id: client.id, tierKey: tierKey || null })
      mutate(['client', clientId])
      toast.success('Tier updated', { icon: <CheckCircle2 className="h-4 w-4" /> })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update tier', { icon: <XCircle className="h-4 w-4" /> })
    } finally {
      setSaving(false)
    }
  }

  if (!tiers) return <Skeleton className="h-24 w-full" />

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Layers className="h-4 w-4 text-primary" /> Pricing-sheet tier <span className="text-xs font-normal text-muted-foreground">(reference only — not billed)</span></CardTitle>
        <p className="text-xs text-muted-foreground">
          What this client&apos;s plan is supposed to include, per the pricing sheet. This label isn&apos;t connected to Stripe — see <span className="font-medium text-foreground">Current plan</span> below for what&apos;s actually being charged.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        {assigned ? (
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-medium">{assigned.name}</span>
              <span className="text-sm tabular-nums">${(assigned.monthlyPriceCents / 100).toFixed(0)}/mo</span>
            </div>
            {/*
              Every bullet here is included in the plan and being delivered —
              much of it by hand, off-dashboard. So they all read the same.
              `built` only decides whether we can offer a deep link to live
              data; it must never look like the client isn't getting something.
              The build-coverage view is superadmin-only, below.
            */}
            <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Included in your plan</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {applicableFeatures(assigned.features, client.hosting, chatEntitled).map(f => (
                <li key={f.text} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  <span>
                    {f.text}
                    {/* 'content' is superadmin-only tooling — for a client that
                        link would just bounce them back to Home, so don't
                        offer it. The bullet itself stays: they ARE getting it. */}
                    {f.built && f.section !== undefined && !(f.section === 'content' && !me?.isSuperadmin) && (
                      <Link
                        to={`/clients/${client.slug}${f.section ? `/${f.section}` : ''}`}
                        className="ml-2 text-xs text-primary hover:underline"
                      >
                        View
                      </Link>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {me?.isSuperadmin && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                Admin note: {assigned.features.filter(f => f.built).length} of {assigned.features.length} bullets
                have live dashboard data. The rest are delivered off-dashboard — see TODO.md.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No tier assigned yet.</p>
        )}

        {me?.isSuperadmin && (
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-4">
            <div className="grid gap-1.5">
              <Label>Tier</Label>
              <select
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={tierKey}
                onChange={e => setTierKey(e.target.value)}
              >
                <option value="">— none —</option>
                {(tiers ?? []).map((t: TierInfo) => (
                  <option key={t.key} value={t.key}>{t.name} — ${(t.monthlyPriceCents / 100).toFixed(0)}/mo</option>
                ))}
              </select>
            </div>
            <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save tier'}</Button>
            <Button size="sm" variant="secondary" onClick={copyPaymentLink} disabled={linking || !tierKey}>
              <Link2 className="h-3.5 w-3.5" /> {linking ? 'Getting link…' : 'Copy payment link'}
            </Button>
          </div>
        )}
        {me?.isSuperadmin && (
          <p className="text-xs text-muted-foreground">
            Default post-launch path: <strong className="text-foreground">we host → Care</strong> (first month included in the build fee);{' '}
            <strong className="text-foreground">they host → chatbot retainer</strong> (on client-owned platforms most of Care is redundant).
            This client: {client.hosting === 'client' ? 'client-hosted' : 'hosted by us'} — set under Config.
          </p>
        )}
        {me?.isSuperadmin && (
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Save tier</strong> sets the label only. <strong className="text-foreground">Copy payment link</strong> gives you a Stripe checkout link for the selected tier — send it to the client, and when they pay, their plan and entitlements switch to match automatically.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// Add-on service marketplace on the billing tab (restored 2026-08-18 — à la
// carte add-ons are a deliberate offering again now that Local Presence is
// purchasable). Renders ONLY status 'available' services: the reason this card
// was removed in July was that it showed coming_soon services with a working
// Comp button. For comped base plans (no card on file) Stripe add-ons can't be
// charged, so we show the superadmin comp toggle instead.
function ServicesCard({ clientId, comped }: { clientId: string; comped: boolean }) {
  const { data: services } = useSWR('services', api.billing.services)
  const { data: me } = useSWR('me', api.me)
  const { entitlements, mutate: mutateEntitlements } = useEntitlements(clientId)
  const [busy, setBusy] = useState<ServiceKey | null>(null)

  // Only services that are genuinely purchasable at a flat monthly price. The
  // status check keeps out coming_soon and tier_only (SEO/Content/Chat come
  // with the tier, at tier prices — never à la carte). The price check keeps
  // out Paid Ads, which is 'available' but whose fee is "greater of a floor or
  // % of spend" — that can't be bought with a one-click Add, and its billing
  // is still deferred anyway (see TODO.md).
  const available = (services ?? []).filter(s => s.status === 'available' && s.monthlyPriceCents > 0)
  if (!services) return <Skeleton className="h-24 w-full" />
  if (available.length === 0) return null

  async function toggleAddon(key: ServiceKey, entitled: boolean) {
    setBusy(key)
    try {
      await api.billing.addon(clientId, key, entitled ? 'remove' : 'add')
      await mutateEntitlements()
      toast.success(entitled ? 'Service removed' : 'Service added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update service')
    } finally {
      setBusy(null)
    }
  }

  async function toggleComp(key: ServiceKey, entitled: boolean) {
    setBusy(key)
    try {
      await api.billing.compService(clientId, key, entitled)
      await mutateEntitlements()
      toast.success(entitled ? 'Service grant revoked' : 'Service comped')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update grant')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add-on services</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 pt-0">
        {available.map(svc => {
          const ent = entitlements?.services[svc.key]
          const entitled = ent?.entitled ?? false
          const isBusy = busy === svc.key
          return (
            <div key={svc.key} className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{svc.name}</span>
                  {entitled && (
                    <Badge variant="success">
                      <StatusDot variant="success" />
                      {ent?.source === 'comp' ? 'Comped' : ent?.source === 'tier' ? 'In plan' : 'Active'}
                    </Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{svc.description}</p>
                {svc.monthlyPriceCents > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    ${(svc.monthlyPriceCents / 100).toFixed(0)}/mo
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                {/* Comped base plans can't run Stripe add-ons; superadmin comps the service instead. */}
                {!comped && ent?.source !== 'tier' && (
                  <Button
                    variant={entitled ? 'outline' : 'default'}
                    size="sm"
                    disabled={isBusy}
                    onClick={() => toggleAddon(svc.key, entitled)}
                  >
                    {isBusy ? '…' : entitled ? 'Remove' : 'Add'}
                  </Button>
                )}
                {me?.isSuperadmin && (comped || ent?.source === 'comp') && (
                  <Button
                    variant={entitled ? 'outline' : 'secondary'}
                    size="sm"
                    disabled={isBusy}
                    onClick={() => toggleComp(svc.key, entitled)}
                  >
                    {isBusy ? '…' : entitled ? 'Revoke comp' : 'Comp'}
                  </Button>
                )}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// Per-deal custom line items — the customization layer on top of the tier
// template (superadmin only; BillingSection already gates this whole branch).
// Billing/presentation only: adding a line item never grants feature access —
// that stays the Comp path in the services card above.
function LineItemsCard({ clientId, client }: { clientId: string; client: import('@agent-platform/shared').Client }) {
  const key = ['line-items', clientId]
  const { data: items } = useSWR(key, () => api.billing.lineItems(clientId))
  const confirm = useConfirm()
  const [label, setLabel] = useState('')
  const [amount, setAmount] = useState('')
  const [cadence, setCadence] = useState<LineItemCadence>('monthly')
  const [included, setIncluded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dealBusy, setDealBusy] = useState<'sub' | 'invoice' | null>(null)

  const amountCents = Math.round((Number(amount) || 0) * 100)

  async function add() {
    if (!label.trim() || amountCents <= 0) return
    setBusy(true)
    try {
      await api.billing.createLineItem(clientId, { label: label.trim(), amountCents, cadence, included, sortOrder: items?.length ?? 0 })
      mutate(key)
      setLabel(''); setAmount(''); setIncluded(false)
      toast.success('Line item added')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add line item')
    } finally {
      setBusy(false)
    }
  }

  async function toggleIncluded(item: ClientLineItem) {
    try {
      await api.billing.updateLineItem(clientId, item.id, { included: !item.included })
      mutate(key)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update line item')
    }
  }

  async function remove(item: ClientLineItem) {
    if (!(await confirm(`Remove "${item.label}" from this client's deal?`))) return
    try {
      await api.billing.deleteLineItem(clientId, item.id)
      mutate(key)
      toast.success('Line item removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove line item')
    }
  }

  async function createDeal() {
    if (!(await confirm('Create a Stripe subscription for this deal (tier + monthly line items, billed by invoice)? Use this only for customized deals — vanilla tiers should use the payment link.'))) return
    setDealBusy('sub')
    try {
      await api.billing.createCustomDeal(clientId)
      mutate(['billing', clientId])
      toast.success('Custom deal subscription created — Stripe will invoice the client')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create subscription')
    } finally {
      setDealBusy(null)
    }
  }

  async function invoiceOneTime() {
    if (!(await confirm('Invoice all unbilled one-time items now? Items already billed are skipped.'))) return
    setDealBusy('invoice')
    try {
      const res = await api.billing.invoiceOneTime(clientId)
      toast.success(`Invoiced ${res.billed} item${res.billed === 1 ? '' : 's'}${res.skipped ? ` (${res.skipped} already billed)` : ''}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create invoice')
    } finally {
      setDealBusy(null)
    }
  }

  const monthlyExtra = (items ?? []).filter(i => i.cadence === 'monthly' && !i.included).reduce((s, i) => s + i.amountCents, 0)
  const oneTimeTotal = (items ?? []).filter(i => i.cadence === 'one_time' && !i.included).reduce((s, i) => s + i.amountCents, 0)
  const hasOneTime = (items ?? []).some(i => i.cadence === 'one_time' && !i.included)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Custom line items <span className="text-xs font-normal text-muted-foreground">(this client&apos;s deal)</span></CardTitle>
        <Link to={`/clients/${client.slug}/info-sheet`} className="text-sm text-primary hover:underline">View info sheet</Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <p className="text-xs text-muted-foreground">
          The tier above is the starting template; anything added, re-priced, or comped for this specific deal goes here.
          Line items are billing only — to grant access to a feature, use Comp on the service itself.
        </p>
        {items === undefined ? (
          <Skeleton className="h-16 w-full" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No custom line items — this client is on the vanilla tier.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map(item => (
              <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                <div className="min-w-0">
                  <span className={`text-sm font-medium ${item.included ? 'text-muted-foreground' : ''}`}>{item.label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{item.cadence === 'monthly' ? 'monthly' : 'one-time'}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`text-sm tabular-nums ${item.included ? 'line-through text-muted-foreground' : ''}`}>
                    ${(item.amountCents / 100).toLocaleString()}
                  </span>
                  {item.included && <Badge variant="secondary">Included</Badge>}
                  <Button variant="ghost" size="sm" title={item.included ? 'Charge for this item' : 'Mark as included ($0, kept on the sheet)'} onClick={() => toggleIncluded(item)}>
                    {item.included ? <Undo2 className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  </Button>
                  <Button variant="ghost" size="sm" title="Remove" onClick={() => remove(item)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
            <p className="text-xs tabular-nums text-muted-foreground">
              +${(monthlyExtra / 100).toLocaleString()}/mo on top of the tier
              {oneTimeTotal > 0 && <> · ${(oneTimeTotal / 100).toLocaleString()} one-time</>}
            </p>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
          <div className="grid flex-1 gap-1.5" style={{ minWidth: '10rem' }}>
            <Label>Label</Label>
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="Website build" />
          </div>
          <div className="grid gap-1.5">
            <Label>Amount ($)</Label>
            <Input value={amount} onChange={e => setAmount(e.target.value)} placeholder="250" className="w-24" inputMode="decimal" />
          </div>
          <div className="grid gap-1.5">
            <Label>Cadence</Label>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={cadence}
              onChange={e => setCadence(e.target.value as LineItemCadence)}
            >
              <option value="monthly">Monthly</option>
              <option value="one_time">One-time</option>
            </select>
          </div>
          <label className="flex h-9 items-center gap-1.5 text-sm">
            <input type="checkbox" checked={included} onChange={e => setIncluded(e.target.checked)} />
            Included ($0)
          </label>
          <Button size="sm" onClick={add} disabled={busy || !label.trim() || amountCents <= 0}>
            {busy ? 'Adding…' : 'Add'}
          </Button>
        </div>
        {(items?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={createDeal} disabled={dealBusy !== null}>
              {dealBusy === 'sub' ? 'Creating…' : 'Create custom Stripe subscription'}
            </Button>
            {hasOneTime && (
              <Button size="sm" variant="outline" onClick={invoiceOneTime} disabled={dealBusy !== null}>
                {dealBusy === 'invoice' ? 'Invoicing…' : 'Invoice one-time items'}
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function BillingTab({ clientId, client }: { clientId: string; client?: import('@agent-platform/shared').Client }) {
  const { data, isLoading } = useSWR(['billing', clientId], () => api.billing.get(clientId), { refreshInterval: 30_000 })
  const { data: services } = useSWR('services', api.billing.services)
  const { data: tiers } = useSWR('tiers', () => api.billing.tiers())
  const { data: me } = useSWR('me', api.me)
  const { entitlements } = useEntitlements(clientId)
  // Superadmin-only: all active Stripe subs for this client, to catch a stale
  // plan still billing after a tier switch (a null key skips the fetch for
  // non-superadmins). staleSubs = every active sub that isn't the tracked one.
  const { data: allSubs, mutate: mutateSubs } = useSWR(
    me?.isSuperadmin ? ['client-subs', clientId] : null,
    () => api.billing.subscriptions(clientId)
  )
  const { data: lineItems } = useSWR(
    me?.isSuperadmin ? ['line-items', clientId] : null,
    () => api.billing.lineItems(clientId)
  )
  const staleSubs = (allSubs ?? []).filter(s => !s.isTracked)
  const [openingPortal, setOpeningPortal] = useState(false)
  const [cancelingSub, setCancelingSub] = useState<string | null>(null)

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

  async function cancelStale(subId: string) {
    setCancelingSub(subId)
    try {
      await api.billing.cancelSubscription(clientId, subId)
      await mutateSubs()
      mutate(['billing', clientId])
      toast.success('Old subscription canceled')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel subscription')
    } finally {
      setCancelingSub(null)
    }
  }

  if (isLoading) return <Skeleton className="h-24 w-full" />

  const sub = data?.subscription
  const isActive = sub && ACTIVE_STATUSES.has(sub.status)
  const comped = sub?.stripeCustomerId === 'comped'

  // Only 'addon' (real Stripe subscription items) actually costs money —
  // 'comp' and 'tier' sources are free until Stripe products exist for tiers.
  // Previously nowhere on this page showed the combined figure: the plan
  // badge and each service's price sat in separate cards with no total.
  const addonCents = (services ?? []).reduce((sum, svc) => {
    const ent = entitlements?.services[svc.key]
    return ent?.source === 'addon' ? sum + svc.monthlyPriceCents : sum
  }, 0)
  const totalCents = comped ? 0 : (data?.plan?.monthlyPriceCents ?? 0) + addonCents

  // The pricing-sheet tier (above) is a plain label, not a Stripe object — see
  // TierCard's comment for why. Flag it for superadmin when the DEAL (tier +
  // add-ons + monthly line items) disagrees with what Stripe is actually
  // charging, so a stale/wrong label gets caught here instead of surfacing as
  // "the numbers don't match" confusion downstream. Stripe's side comes from
  // the tracked sub's summed items (a custom deal carries inline prices the
  // catalog doesn't know about), falling back to the catalog-derived total.
  const assignedTier = tiers?.find(t => t.key === client?.tierKey) ?? null
  const lineItemMonthlyCents = (lineItems ?? [])
    .filter(i => i.cadence === 'monthly' && !i.included)
    .reduce((s, i) => s + i.amountCents, 0)
  const expectedCents = (assignedTier?.monthlyPriceCents ?? 0) + addonCents + lineItemMonthlyCents
  const stripeCents = allSubs?.find(s => s.isTracked)?.amountCents ?? totalCents
  const tierMismatch = me?.isSuperadmin && isActive && !comped && assignedTier && expectedCents !== stripeCents

  return (
    <div className="grid gap-3">
      {staleSubs.length > 0 && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="pt-5 text-sm">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="flex-1">
                <span className="font-medium">
                  This client has {staleSubs.length} older active subscription{staleSubs.length > 1 ? 's' : ''} still billing.
                </span>{' '}
                <span className="text-muted-foreground">
                  Left over from a plan switch — cancel {staleSubs.length > 1 ? 'them' : 'it'} so the client isn&apos;t double-charged. The current plan below stays active.
                </span>
                <div className="mt-3 flex flex-col gap-2">
                  {staleSubs.map(s => (
                    <div key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-background/50 px-3 py-2">
                      <span className="tabular-nums">
                        {s.amountCents != null ? `$${(s.amountCents / 100).toFixed(0)}/mo` : 'Subscription'}
                        <span className="ml-1.5 text-xs text-muted-foreground">· started {new Date(s.created).toLocaleDateString()}</span>
                      </span>
                      <Button size="sm" variant="destructive" disabled={cancelingSub === s.id} onClick={() => cancelStale(s.id)}>
                        {cancelingSub === s.id ? 'Canceling…' : 'Cancel'}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      {tierMismatch && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="flex items-start gap-3 pt-5 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div>
              <span className="font-medium">The deal doesn&apos;t match what Stripe is billing.</span>{' '}
              <span className="text-muted-foreground">
                Tier + add-ons + line items say ${(expectedCents / 100).toFixed(0)}/mo, Stripe is charging ${((stripeCents ?? 0) / 100).toFixed(0)}/mo.
                Send the client the tier&apos;s payment link, recreate the custom subscription, or fix whichever side is wrong.
              </span>
            </div>
          </CardContent>
        </Card>
      )}
      {/* Gated on isActive, not on sub being present — a canceled/incomplete_expired
          subscription row still exists in Stripe and would otherwise render here as
          if it were the client's current plan, which is exactly backwards: a canceled
          sub is the ONE case that must never be shown as "current." Single card, one
          state or the other, no redundant "canceled" + "no active subscription" pair. */}
      {isActive ? (
        <Card>
          <CardContent className="flex items-start justify-between gap-4 pt-5">
            <div className="flex items-start gap-3">
              <CreditCard className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <div className="font-medium">Current plan</div>
                <Badge variant={subStatusVariant(sub!.status)} className="mt-1.5">
                  <StatusDot variant={subStatusVariant(sub!.status)} />
                  {data?.plan?.name ?? 'Unknown plan'} — {sub!.status}
                </Badge>
                {sub!.currentPeriodEnd && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {sub!.status === 'active' ? 'Renews' : 'Ends'} {new Date(sub!.currentPeriodEnd).toLocaleDateString()}
                  </p>
                )}
                {comped ? (
                  <p className="mt-1.5 text-xs text-muted-foreground">Comped by admin — no card on file.</p>
                ) : (
                  <p className="mt-1.5 text-sm font-medium tabular-nums">
                    ${(totalCents / 100).toFixed(0)}/mo total
                    {addonCents > 0 && (
                      <span className="ml-1 font-normal text-xs text-muted-foreground">
                        (${((data?.plan?.monthlyPriceCents ?? 0) / 100).toFixed(0)} plan + ${(addonCents / 100).toFixed(0)} add-ons)
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
            {!comped && (
              <Button variant="secondary" size="sm" onClick={openPortal} disabled={openingPortal}>
                {openingPortal ? 'Opening…' : 'Manage billing'}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex items-start gap-3 pt-5">
            <CreditCard className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div>
              <div className="font-medium">No active plan</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Pick a tier above and use <span className="font-medium text-foreground">Copy payment link</span> to
                send this client a checkout link — once they pay, their plan activates here automatically.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {isActive && <ServicesCard clientId={clientId} comped={comped} />}
      {isActive && <UsageCard clientId={clientId} />}
    </div>
  )
}

// Internal-dashboard-only branding — shown in the app shell breadcrumb next
// to the client name (Building2 icon when unset). NOT the public chat-widget
// logo (that's under Widget setup → Appearance); this one is never served to
// a website visitor.
function OrgLogoField({ client, clientId }: { client: import('@agent-platform/shared').Client; clientId: string }) {
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function upload(file: File | undefined) {
    if (!file) return
    setBusy(true)
    try {
      await api.clients.uploadOrgLogo(client.id, file)
      mutate(['client', clientId])
      toast.success('Logo uploaded')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await api.clients.removeOrgLogo(client.id)
      mutate(['client', clientId])
      toast.success('Logo removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove logo')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Organization logo <span className="font-normal text-muted-foreground">(shown next to the client name in this dashboard — not the public widget logo)</span></Label>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
          {client.logoUrl
            ? <img src={client.logoUrl} alt="" className="h-full w-full object-contain" />
            : <Building2 className="h-4 w-4 text-muted-foreground" />}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
          className="hidden"
          onChange={e => { upload(e.target.files?.[0]); e.target.value = '' }}
        />
        <Button variant="outline" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload className="h-3.5 w-3.5" />{busy ? 'Working…' : client.logoPath ? 'Replace' : 'Upload logo'}
        </Button>
        {client.logoPath && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={remove}>
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </Button>
        )}
      </div>
    </div>
  )
}

// The backend still stores/sends these as one comma-separated string (see
// EmailListField's comment) — these two helpers are the only place that
// string is parsed/built, so every editor stays in sync.
function splitEmails(value: string | undefined | null): string[] {
  return value ? value.split(',').map(e => e.trim()).filter(Boolean) : []
}
function joinEmails(emails: string[]): string | undefined {
  const joined = emails.map(e => e.trim()).filter(Boolean).join(', ')
  return joined || undefined
}

function ConfigTab({ clientId, client }: { clientId: string; client: import('@agent-platform/shared').Client }) {
  const cfg = client.agentConfig ?? {}
  const { data: me } = useSWR('me', api.me)
  const navigate = useNavigate()
  const [name, setName] = useState(client.name)
  const [slug, setSlug] = useState(client.slug)
  const [domain, setDomain] = useState(client.domain ?? '')
  const [hosting, setHosting] = useState<HostingOwner>(client.hosting ?? 'us')
  const [systemPromptExtra, setExtra] = useState(cfg.systemPromptExtra ?? '')
  const [escalationEmails, setEscalationEmails] = useState(splitEmails(cfg.escalationEmail))
  const [supportEmails, setSupportEmails] = useState(splitEmails(cfg.supportEmail))
  const [saving, setSaving] = useState(false)

  const normalizedDomain = normalizeDomain(domain)
  const domainError = normalizedDomain && !isPublicHost(normalizedDomain)
    ? `"${normalizedDomain}" doesn't look like a real public website (not localhost or a private address).`
    : null

  async function save() {
    if (domainError) return
    setSaving(true)
    try {
      const updated = await api.clients.upsert({
        id: client.id,
        ...(me?.isSuperadmin ? { name, domain: normalizedDomain, slug, hosting } : {}),
        agentConfig: { ...cfg, systemPromptExtra, escalationEmail: joinEmails(escalationEmails), supportEmail: joinEmails(supportEmails) }
      })
      mutate(['client', clientId])
      toast.success('Config saved', { icon: <CheckCircle2 className="h-4 w-4" /> })
      // The current URL is keyed by the old slug — a superadmin who just
      // renamed it would otherwise be left on a now-stale link (still works,
      // since it's served from history, but every fresh copy/share of the URL
      // from here on should use the new one).
      if (me?.isSuperadmin && updated.slug !== client.slug) {
        setSlug(updated.slug)
        navigate(`/clients/${updated.slug}/config`, { replace: true })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save', { icon: <XCircle className="h-4 w-4" /> })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardContent className="grid gap-4 pt-5">
        {me?.isSuperadmin && <OrgLogoField client={client} clientId={clientId} />}
        {me?.isSuperadmin && (
          <div className="grid gap-1.5">
            <Label>Client name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Client name" />
          </div>
        )}
        {me?.isSuperadmin && (
          <div className="grid gap-1.5">
            <Label>Dashboard URL</Label>
            <Input
              value={slug}
              onChange={e => setSlug(e.target.value)}
              placeholder="spec-id"
            />
            <p className="text-xs text-muted-foreground">
              /clients/<span className="font-medium text-foreground">{slug || '…'}</span> — lowercased and de-duplicated automatically on save if it collides with another client.
            </p>
          </div>
        )}
        {me?.isSuperadmin && (
          <div className="grid gap-1.5">
            <Label>Website URL</Label>
            <Input
              value={domain}
              onChange={e => setDomain(e.target.value)}
              placeholder="example.com"
              aria-invalid={!!domainError}
              className={domainError ? 'border-destructive' : ''}
            />
            {domainError ? (
              <p className="text-xs text-destructive">{domainError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                The client&apos;s live public website — this is the <span className="font-medium text-foreground">one</span> domain used everywhere across the platform: <span className="font-medium text-foreground">Site Health</span> checks, the <span className="font-medium text-foreground">SEO Audit</span> crawl target, and the Search Console default. Get this wrong and every one of those breaks with a confusing error instead of an obvious one.
              </p>
            )}
          </div>
        )}
        {me?.isSuperadmin && (
          <div className="grid gap-1.5">
            <Label>Who hosts the website</Label>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={hosting}
              onChange={e => setHosting(e.target.value as HostingOwner)}
            >
              <option value="us">We host (our build — default)</option>
              <option value="client">Client owns the platform (e.g. their Squarespace)</option>
            </select>
            <p className="text-xs text-muted-foreground">
              Drives what we promise: client-hosted sites don&apos;t get the hosting/uptime Care bullet or the Site Health card
              (we can&apos;t act on uptime we don&apos;t control), and their default retainer is the chatbot rather than Care.
            </p>
          </div>
        )}
        {/* Admin-only: how the agency configures the assistant's knowledge.
            The client never sets this — we set it up for them. */}
        {me?.isSuperadmin && (
          <div className="grid gap-1.5">
            <Label>Assistant instructions <span className="font-normal text-muted-foreground">(admin only — the chatbot&apos;s business context)</span></Label>
            <Textarea value={systemPromptExtra} onChange={e => setExtra(e.target.value)} rows={4} placeholder="What the assistant should know about this business — services, hours, policies, tone…" />
          </div>
        )}
        <div className="grid gap-1.5">
          <Label>Lead email(s) <span className="font-normal text-muted-foreground">(where captured leads are sent — contact form, chatbot, website calculators)</span></Label>
          <EmailListField emails={escalationEmails} onChange={setEscalationEmails} placeholder="sales@yourcompany.com" />
        </div>
        <div className="grid gap-1.5">
          <Label>Support escalation email(s) <span className="font-normal text-muted-foreground">(where "get a human" / couldn't-answer hand-offs are sent; empty = same as lead emails)</span></Label>
          <EmailListField emails={supportEmails} onChange={setSupportEmails} placeholder="support@yourcompany.com" />
        </div>
        <Button onClick={save} disabled={saving || !!domainError} className="justify-self-start">
          {saving ? 'Saving…' : 'Save config'}
        </Button>
      </CardContent>
    </Card>
  )
}

function NotificationSettingsCard({ clientId }: { clientId: string }) {
  const key = ['notification-settings', clientId]
  const { data: settings, isLoading } = useSWR(key, () => api.clients.notificationSettings(clientId))
  const [emailEnabled, setEmailEnabled] = useState(false)
  const [emailTo, setEmailTo] = useState<string[]>([])
  const [slackEnabled, setSlackEnabled] = useState(false)
  const [slackWebhookUrl, setSlackWebhookUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // Seed local state once, when settings first arrive — avoids clobbering
  // in-progress edits on background revalidation.
  if (settings && !loaded) {
    setEmailEnabled(settings.email_enabled)
    setEmailTo(splitEmails(settings.email_to))
    setSlackEnabled(settings.slack_enabled)
    setSlackWebhookUrl(settings.slack_webhook_url ?? '')
    setLoaded(true)
  }

  async function save() {
    setSaving(true)
    try {
      await api.clients.updateNotificationSettings(clientId, {
        emailEnabled, emailTo: joinEmails(emailTo) ?? '', slackEnabled, slackWebhookUrl
      })
      mutate(key)
      toast.success('Notification settings saved', { icon: <CheckCircle2 className="h-4 w-4" /> })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save', { icon: <XCircle className="h-4 w-4" /> })
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) return <Skeleton className="h-48 w-full" />

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 pt-0">
        <p className="text-xs text-muted-foreground">
          Get notified when a change request comes in or its status changes.
        </p>
        <div className="grid gap-1.5">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={emailEnabled} onChange={e => setEmailEnabled(e.target.checked)} />
            Email
          </label>
          {emailEnabled && (
            <EmailListField emails={emailTo} onChange={setEmailTo} placeholder="you@yourcompany.com" />
          )}
        </div>
        <div className="grid gap-1.5">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={slackEnabled} onChange={e => setSlackEnabled(e.target.checked)} />
            Slack
          </label>
          {slackEnabled && (
            <Input value={slackWebhookUrl} onChange={e => setSlackWebhookUrl(e.target.value)} placeholder="https://hooks.slack.com/services/…" />
          )}
        </div>
        <Button onClick={save} disabled={saving} className="justify-self-start">
          {saving ? 'Saving…' : 'Save notification settings'}
        </Button>
      </CardContent>
    </Card>
  )
}
