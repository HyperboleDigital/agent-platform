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

// For routes that are internal agency tooling rather than something the
// client operates themselves — both client sections (Content, Info Sheet) and
// top-level superadmin views (/jobs). The matching nav entries are hidden for
// clients too — this guards the URL, since a hidden link is not access
// control.
//
// Redirects rather than showing a "no access" wall: to a client this section
// doesn't conceptually exist, so an error about it would only raise questions.
//
// NOTE: outside ClientLayout there is no outlet context at all —
// useClientCtx() returns undefined, not a partial object — so everything
// derived from it here must be optional or this crashes on top-level routes.
export function AdminOnly({ children }: { children: ReactNode }) {
  const ctx = useClientCtx() as ReturnType<typeof useClientCtx> | undefined
  const { data: me, isLoading } = useSWR('me', api.me)
  if (isLoading && !me) return <Skeleton className="h-64 w-full" />
  if (me?.isSuperadmin) return <>{children}</>
  // Not a superadmin: send them somewhere that exists for them. Inside a
  // client section that's the client's own home — wait for the slug to
  // resolve rather than redirecting blind; on a top-level route it's the
  // app root.
  if (ctx && !ctx.client) return <Skeleton className="h-64 w-full" />
  return <Navigate to={ctx?.client ? `/clients/${ctx.client.slug}` : '/'} replace />
}
