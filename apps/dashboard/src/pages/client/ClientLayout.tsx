import { Outlet, useOutletContext, useParams, Link } from 'react-router-dom'
import useSWR from 'swr'
import { ArrowLeft } from 'lucide-react'
import type { Client } from '@agent-platform/shared'
import { api } from '@/lib/api'
import { useEntitlements } from '@/hooks/use-entitlements'
import { OnboardingModal } from '@/components/onboarding-modal'

// Shared context for every client section, so sections don't each refetch the
// client. clientId is always present; client may still be loading.
export interface ClientCtx {
  clientId: string
  client: Client | undefined
}

export function useClientCtx(): ClientCtx {
  return useOutletContext<ClientCtx>()
}

// Wraps all /clients/:id/* sections. Section nav itself lives in the app shell
// sidebar (role- and entitlement-aware); this just resolves the client and
// renders a header + the active section.
//
// Access is NOT gated on billing: being an invited member of a client's org IS
// the client relationship — so an invited client always sees their dashboard.
// Billing/subscription status is surfaced on Home (PlanStatusCard) as a prompt
// to activate, and individual paid features stay gated by tier entitlement, but
// we never wall a real client out of their own portal.
export default function ClientLayout() {
  const { id = '' } = useParams()
  const { data: client } = useSWR(id ? ['client', id] : null, () => api.clients.get(id))
  const { data: me } = useSWR('me', api.me)
  const { entitlements } = useEntitlements(id)

  // Show the onboarding/notifications modal to the client (never superadmin)
  // when either: they've never been onboarded (first login), OR their Chat
  // Assistant is unlocked but they haven't told us where to send notifications.
  const chatEntitled = entitlements?.services.chat?.entitled ?? false
  const needsOnboarding = !!client && !client.portalConfig?.onboardedAt
  const needsNotifications = chatEntitled && !!client && !client.agentConfig?.escalationEmail
  const showOnboarding = !!me && !me.isSuperadmin && (needsOnboarding || needsNotifications)

  return (
    <div className="flex flex-col gap-6">
      <div>
        {/* Superadmins navigate in from the client list; org users have no list to go back to. */}
        {me?.isSuperadmin && (
          <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" /> All clients
          </Link>
        )}
        <h1 className={`text-xl font-semibold ${me?.isSuperadmin ? 'mt-2' : ''}`}>{client?.name ?? 'Client'}</h1>
      </div>

      <Outlet context={{ clientId: id, client } satisfies ClientCtx} />

      {showOnboarding && client && (
        <OnboardingModal client={client} chatEntitled={chatEntitled} />
      )}
    </div>
  )
}
