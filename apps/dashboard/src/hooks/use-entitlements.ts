import useSWR from 'swr'
import { api, type Entitlements, type ServiceKey } from '@/lib/api'

// Shared entitlement fetch, used by the nav (lock icons) and by gated pages
// (LockedSection). Keyed per client so switching clients refetches.
export function useEntitlements(clientId: string | undefined) {
  const { data, error, isLoading, mutate } = useSWR<Entitlements>(
    clientId ? ['entitlements', clientId] : null,
    () => api.clients.entitlements(clientId!)
  )
  return { entitlements: data, error, isLoading, mutate }
}

export function isServiceEntitled(entitlements: Entitlements | undefined, key: ServiceKey): boolean {
  return entitlements?.services[key]?.entitled ?? false
}
