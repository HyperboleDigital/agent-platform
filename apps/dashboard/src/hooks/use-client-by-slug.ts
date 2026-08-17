import useSWR from 'swr'
import { api } from '@/lib/api'

// Resolves the /clients/:slug URL segment to the full client record. Shared
// by anything that needs client data ABOVE ClientLayout (the app shell, which
// renders around the routed page and can't reach ClientLayout's own resolved
// id) — ClientLayout itself does its own two-step slug->id->client fetch so
// its `['client', id]` SWR key matches what every section already `mutate()`s.
export function useClientBySlug(slug: string | undefined) {
  return useSWR(slug ? ['client-slug-lookup', slug] : null, () => api.clients.getBySlug(slug!))
}
