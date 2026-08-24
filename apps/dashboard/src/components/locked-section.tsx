import { useState } from 'react'
import useSWR from 'swr'
import { Lock, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { api, type ServiceKey } from '@/lib/api'
import { useEntitlements } from '@/hooks/use-entitlements'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ContactButton } from '@/components/contact-button'

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

// Full-page gate shown in place of a section the client isn't entitled to.
// Renders the service's marketing copy + price.
//
// Clients get a "Contact us" CTA, NOT a self-serve purchase button: adding a
// service changes what they're billed, and that's a conversation we want to
// have rather than a one-click charge from a locked screen. The provisioning
// actions (add to plan / comp) are superadmin-only, below.
export function LockedSection({ clientId, serviceKey }: { clientId: string; serviceKey: ServiceKey }) {
  const { data: services } = useSWR('services', api.billing.services)
  const { data: me } = useSWR('me', api.me)
  const { mutate: mutateEntitlements } = useEntitlements(clientId)
  const [busy, setBusy] = useState(false)

  const service = services?.find(s => s.key === serviceKey)
  const comingSoon = service?.status === 'coming_soon'
  // Only an 'available' service can be bought as a monthly add-on. A
  // 'tier_only' service (SEO, Content, Chat) is granted by being on the tier
  // that includes it — showing its legacy à-la-carte price here would quote a
  // number that isn't on the pricing sheet, and "Add to plan" would fail
  // server-side anyway (addServiceToSubscription refuses non-available).
  const purchasable = service?.status === 'available'

  async function purchase() {
    setBusy(true)
    try {
      await api.billing.addon(clientId, serviceKey, 'add')
      await mutateEntitlements()
      toast.success(`${service?.name ?? 'Service'} added to your plan`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add the service')
    } finally {
      setBusy(false)
    }
  }

  async function comp() {
    setBusy(true)
    try {
      await api.billing.compService(clientId, serviceKey, false)
      await mutateEntitlements()
      toast.success(`${service?.name ?? 'Service'} comped for this client`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not comp the service')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center py-16">
      <Card className="max-w-md">
        <CardContent className="flex flex-col items-center gap-4 px-8 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent">
            <Lock className="h-5 w-5 text-accent-foreground" />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-center gap-2">
              <h2 className="text-lg font-semibold">{service?.name ?? 'Service'}</h2>
              {comingSoon && <Badge variant="secondary">Coming soon</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{service?.description}</p>
          </div>

          {/* Superadmin only: the price informs "Add to plan" below, which is a
              real billing action. Clients don't see it — pricing a service they
              don't have yet is the conversation the contact CTA starts, not a
              number to weigh alone on a locked screen. */}
          {service && purchasable && me?.isSuperadmin && (
            <p className="text-sm">
              <span className="text-lg font-semibold tabular-nums">{formatCents(service.monthlyPriceCents)}</span>
              <span className="text-muted-foreground"> / month</span>
            </p>
          )}

          {/* Client-facing: talk to us. No self-serve billing change here. */}
          {!me?.isSuperadmin && !comingSoon && (
            <div className="w-full [&>button]:w-full">
              <ContactButton
                clientId={clientId}
                variant="default"
                label="Contact us about this"
                defaultTopic="Choosing or changing my plan"
              />
            </div>
          )}

          {/* Superadmin provisioning — the actions that actually change billing. */}
          {me?.isSuperadmin && (
            <div className="flex w-full flex-col gap-2">
              {purchasable && (
                <Button onClick={purchase} disabled={busy} className="w-full">
                  <Sparkles className="h-4 w-4" />
                  {busy ? 'Adding…' : 'Add to plan'}
                </Button>
              )}
              {service?.status === 'tier_only' && (
                <p className="text-xs text-muted-foreground">
                  Included with the plan that covers it — move this client onto that tier on the Billing tab, or comp it below.
                </p>
              )}
              <Button onClick={comp} disabled={busy} variant="outline" size="sm" className="w-full">
                Comp this service
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
