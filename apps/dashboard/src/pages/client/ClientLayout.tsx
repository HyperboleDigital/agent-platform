import { Outlet, useOutletContext, useParams, Link } from 'react-router-dom'
import useSWR from 'swr'
import { ArrowLeft } from 'lucide-react'
import type { Client } from '@agent-platform/shared'
import { api } from '@/lib/api'

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
export default function ClientLayout() {
  const { id = '' } = useParams()
  const { data: client } = useSWR(id ? ['client', id] : null, () => api.clients.get(id))
  const { data: me } = useSWR('me', api.me)

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
    </div>
  )
}
