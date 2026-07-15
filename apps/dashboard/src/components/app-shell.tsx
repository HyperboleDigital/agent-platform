import { Outlet, Link, useLocation } from 'react-router-dom'
import useSWR from 'swr'
import type { LucideIcon } from 'lucide-react'
import {
  Users, Sparkles, LayoutDashboard, Plug, Search, Bot,
  MessageSquarePlus, FileBarChart, CreditCard, Settings, Lock, Building2
} from 'lucide-react'
import { UserButton } from '@clerk/react'
import { dark } from '@clerk/themes'
import { api, checkHealth, type ServiceKey } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useEntitlements } from '@/hooks/use-entitlements'
import { ThemeToggle } from '@/components/theme-toggle'
import { useTheme } from 'next-themes'
import { ServerDownScreen } from '@/components/server-down-screen'

const TOP_NAV = [{ label: 'Clients', to: '/', icon: Users }]
const SUPERADMIN_TOP_NAV = [{ label: 'Overview', to: '/overview', icon: LayoutDashboard }]

// Per-client sections. `to` is relative to /clients/:id ('' = the index/home).
// `serviceKey` marks sections gated behind an add-on service — shown with a
// lock icon until entitled, but always visible so clients see what's on offer.
interface ClientNavItem {
  label: string
  to: string
  icon: LucideIcon
  serviceKey?: ServiceKey
}
const CLIENT_SECTIONS: ClientNavItem[] = [
  { label: 'Home', to: '', icon: LayoutDashboard },
  { label: 'Chat Assistant', to: 'assistant', icon: Bot },
  { label: 'Leads', to: 'leads', icon: Users },
  { label: 'Connectors', to: 'connectors', icon: Plug },
  { label: 'SEO + AI Visibility', to: 'seo', icon: Search, serviceKey: 'seo' },
  { label: 'Content', to: 'content', icon: Sparkles, serviceKey: 'content' },
  { label: 'Requests', to: 'requests', icon: MessageSquarePlus },
  { label: 'Reports', to: 'reports', icon: FileBarChart },
  { label: 'Billing', to: 'billing', icon: CreditCard },
  { label: 'Config', to: 'config', icon: Settings }
]

function NavLink({ to, active, icon: Icon, label, locked }: {
  to: string; active: boolean; icon: LucideIcon; label: string; locked?: boolean
}) {
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="flex-1">{label}</span>
      {locked && <Lock className="h-3 w-3 opacity-60" />}
    </Link>
  )
}

// Client section nav, shown when inside /clients/:id/* — with lock icons on
// sections the client isn't entitled to.
function ClientNav({ clientId }: { clientId: string }) {
  const location = useLocation()
  const { entitlements } = useEntitlements(clientId)
  const base = `/clients/${clientId}`

  return (
    <>
      {CLIENT_SECTIONS.map(item => {
        const to = item.to ? `${base}/${item.to}` : base
        const active = item.to ? location.pathname === to : location.pathname === base
        const locked = !!item.serviceKey && !(entitlements?.services[item.serviceKey]?.entitled ?? false)
        return <NavLink key={item.label} to={to} active={active} icon={item.icon} label={item.label} locked={locked} />
      })}
    </>
  )
}

function Sidebar() {
  const location = useLocation()
  const { data: me } = useSWR('me', api.me)

  // Which client's sections to show (if any) — parsed from the URL so the shell
  // (a layout above the routed match) can react to it.
  const clientId = location.pathname.match(/^\/clients\/([^/]+)/)?.[1]
  const topNav = me?.isSuperadmin ? [...SUPERADMIN_TOP_NAV, ...TOP_NAV] : TOP_NAV

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
      <div className="flex h-14 items-center gap-2 border-b border-border px-5">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Agent Platform</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-3">
        {clientId ? (
          <>
            {/* Superadmins keep a way back to the platform-level views. */}
            {me?.isSuperadmin && (
              <>
                {topNav.map(item => (
                  <NavLink key={item.to} to={item.to} active={false} icon={item.icon} label={item.label} />
                ))}
                <div className="my-2 border-t border-border" />
              </>
            )}
            <ClientNav clientId={clientId} />
          </>
        ) : (
          topNav.map(item => (
            <NavLink key={item.to} to={item.to} active={location.pathname === item.to} icon={item.icon} label={item.label} />
          ))
        )}
      </nav>

      <div className="border-t border-border p-3 text-xs text-muted-foreground">
        {me?.isSuperadmin ? 'Superadmin' : me?.orgId ? 'Client account' : 'No client linked'}
      </div>
    </aside>
  )
}

// Shows what you're currently looking at — the client name (+ section) when
// inside /clients/:id/*, or a platform-level label otherwise. Otherwise this
// header space just sits empty.
function Breadcrumb() {
  const location = useLocation()
  const clientId = location.pathname.match(/^\/clients\/([^/]+)/)?.[1]
  const { data: client } = useSWR(clientId ? ['client', clientId] : null, () => api.clients.get(clientId!))

  if (clientId) {
    const section = CLIENT_SECTIONS.find(item => {
      const to = item.to ? `/clients/${clientId}/${item.to}` : `/clients/${clientId}`
      return location.pathname === to
    })
    return (
      <div className="flex items-center gap-2 text-sm">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{client?.name ?? 'Loading…'}</span>
        {section && section.to && <span className="text-muted-foreground">/ {section.label}</span>}
      </div>
    )
  }

  if (location.pathname === '/overview') {
    return (
      <div className="flex items-center gap-2 text-sm">
        <LayoutDashboard className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">Platform Overview</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <Users className="h-4 w-4 text-muted-foreground" />
      <span className="font-medium">All Clients</span>
    </div>
  )
}

function Topbar() {
  const { theme } = useTheme()
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-5">
      <Breadcrumb />
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <UserButton appearance={{ baseTheme: theme === 'light' ? undefined : dark } as never} />
      </div>
    </header>
  )
}

export function AppShell() {
  // Polled independently of any page's own data fetching, so "API is down" is
  // caught in one place rather than as N different broken/stuck pages. Clerk
  // is a separate service and stays up regardless, so this is deliberately
  // NOT a redirect-to-sign-in — the user is still authenticated, the backend
  // just isn't answering.
  const { data: healthy, isLoading, isValidating, mutate } = useSWR('health-check', checkHealth, {
    refreshInterval: 15_000,
    revalidateOnFocus: true
  })

  if (!isLoading && healthy === false) {
    return <ServerDownScreen onRetry={() => mutate()} retrying={isValidating} />
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-auto">
          <div className="container max-w-6xl py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
