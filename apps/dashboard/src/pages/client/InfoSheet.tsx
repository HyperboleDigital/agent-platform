import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { Layers, FileText, CheckCircle2 } from 'lucide-react'
import { api } from '@/lib/api'
import { useClientCtx } from '@/pages/client/ClientLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

// The per-deal info sheet: a client's full commercial picture in one place —
// tier, add-ons, custom line items, one-time fees, and the totals. This is
// the artifact that goes to the client, so it reads as an offer, not a debug
// table. Superadmin-only (route-gated via AdminOnly in main.tsx).
//
// Dashboard view first, deliberately — if a PDF download is wanted later, use
// the same branded-PDF path the SEO audit report uses (lib/audit-pdf.ts on the
// API side), not a second export pipeline.

function usd(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export default function InfoSheet() {
  const { clientId } = useClientCtx()
  const { data: sheet, error } = useSWR(clientId ? ['info-sheet', clientId] : null, () => api.billing.infoSheet(clientId))

  if (error) return <p className="text-sm text-destructive">{error instanceof Error ? error.message : 'Failed to load info sheet'}</p>
  if (!sheet) return <div className="flex flex-col gap-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div>

  const monthlyItems = sheet.lineItems.filter(i => i.cadence === 'monthly')
  const oneTimeItems = sheet.lineItems.filter(i => i.cadence === 'one_time')
  // Hide bullets that don't apply to this client's deal, same rules as the
  // plan cards: hosting promises only when we host; the assistant-stays-live
  // bullet only when there's an assistant (approximated here by the deal
  // including or comping chat — the API's tier features carry the flags).
  const tierFeatures = (sheet.tier?.features ?? []).filter(f =>
    (!f.hostedOnly || sheet.hosting !== 'client') &&
    (!f.chatOnly || sheet.addons.some(a => a.key === 'chat'))
  )

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Service agreement summary</p>
          <h1 className="text-xl font-semibold">{sheet.clientName}</h1>
        </div>
        <FileText className="h-5 w-5 text-muted-foreground" />
      </div>

      {sheet.tier ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Layers className="h-4 w-4 text-primary" /> {sheet.tier.name} plan</CardTitle>
            <span className="text-sm font-semibold tabular-nums">{usd(sheet.tier.monthlyPriceCents)}/mo</span>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="flex flex-col gap-1.5">
              {tierFeatures.map(f => (
                <li key={f.text} className="flex items-start gap-2 text-sm">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  <span>{f.text}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-5 text-sm text-muted-foreground">
            No tier assigned yet — assign one on the <Link to={`/clients/${sheet.clientSlug}/billing`} className="text-primary hover:underline">Billing tab</Link> first.
          </CardContent>
        </Card>
      )}

      {sheet.addons.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Add-on services</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0">
            {sheet.addons.map(a => (
              <div key={a.key} className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-sm font-medium">{a.name}</span>
                  <p className="text-xs text-muted-foreground">{a.description}</p>
                </div>
                <span className="shrink-0 text-sm tabular-nums">
                  {a.comped ? (
                    <>
                      {a.monthlyPriceCents > 0 && <span className="mr-1.5 text-muted-foreground line-through">{usd(a.monthlyPriceCents)}/mo</span>}
                      <Badge variant="success">Included</Badge>
                    </>
                  ) : (
                    `${usd(a.monthlyPriceCents)}/mo`
                  )}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {monthlyItems.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Custom monthly services</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0">
            {monthlyItems.map(i => (
              <div key={i.id} className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-sm font-medium">{i.label}</span>
                  {i.description && <p className="text-xs text-muted-foreground">{i.description}</p>}
                </div>
                <span className="shrink-0 text-sm tabular-nums">
                  {i.included ? (
                    <>
                      <span className="mr-1.5 text-muted-foreground line-through">{usd(i.amountCents)}/mo</span>
                      <Badge variant="success">Included</Badge>
                    </>
                  ) : (
                    `${usd(i.amountCents)}/mo`
                  )}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {oneTimeItems.length > 0 && (
        <Card>
          <CardHeader><CardTitle>One-time work</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0">
            {oneTimeItems.map(i => (
              <div key={i.id} className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-sm font-medium">{i.label}</span>
                  {i.description && <p className="text-xs text-muted-foreground">{i.description}</p>}
                </div>
                <span className="shrink-0 text-sm tabular-nums">
                  {i.included ? (
                    <>
                      <span className="mr-1.5 text-muted-foreground line-through">{usd(i.amountCents)}</span>
                      <Badge variant="success">Included</Badge>
                    </>
                  ) : (
                    usd(i.amountCents)
                  )}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="border-primary/40">
        <CardContent className="flex flex-col gap-1.5 pt-5">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">Monthly total</span>
            <span className="text-lg font-semibold tabular-nums">{usd(sheet.monthlyTotalCents)}/mo</span>
          </div>
          {sheet.oneTimeTotalCents > 0 && (
            <div className="flex items-baseline justify-between text-muted-foreground">
              <span className="text-sm">One-time total</span>
              <span className="text-sm tabular-nums">{usd(sheet.oneTimeTotalCents)}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
