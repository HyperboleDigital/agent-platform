import type { ReactNode } from 'react'
import type { ServiceKey } from '@/lib/api'
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
