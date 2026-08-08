import type { ReactNode } from 'react'
import useSWR from 'swr'
import { Navigate } from 'react-router-dom'
import { api, type ServiceKey } from '@/lib/api'
import { useEntitlements } from '@/hooks/use-entitlements'
import { useClientCtx } from '@/pages/client/ClientLayout'
import { LockedSection } from '@/components/locked-section'
import { Skeleton } from '@/components/ui/skeleton'

// Renders children only when the client is entitled to `service`; otherwise
// shows the upgrade gate. API routes enforce the same entitlement server-side,
// so this is purely presentational.
export function Gate({ service, children }: { service: ServiceKey; children: ReactNode }) {
  const { clientId } = useClientCtx()
  const { entitlements, isLoading } = useEntitlements(clientId)
  if (isLoading && !entitlements) return <Skeleton className="h-64 w-full" />
  if (!entitlements?.services[service]?.entitled) return <LockedSection clientId={clientId} serviceKey={service} />
  return <>{children}</>
}

// For sections that are internal agency tooling rather than something the
// client operates themselves (Content, where we draft and publish posts on
// their behalf). The matching nav entry is hidden for clients too — this
// guards the URL, since a hidden link is not access control.
//
// Redirects rather than showing a "no access" wall: to a client this section
// doesn't conceptually exist, so an error about it would only raise questions.
export function AdminOnly({ children }: { children: ReactNode }) {
  const { clientId } = useClientCtx()
  const { data: me, isLoading } = useSWR('me', api.me)
  if (isLoading && !me) return <Skeleton className="h-64 w-full" />
  if (!me?.isSuperadmin) return <Navigate to={`/clients/${clientId}`} replace />
  return <>{children}</>
}
