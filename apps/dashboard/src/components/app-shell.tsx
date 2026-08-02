import { useState, useEffect } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import useSWR from 'swr'
import { toast } from 'sonner'
import type { LucideIcon } from 'lucide-react'
import {
  Users, Sparkles, LayoutDashboard, Search, Bot,
  MessageSquarePlus, FileBarChart, CreditCard, Settings, Lock, Building2, MapPin, Target, Megaphone, Users2
} from 'lucide-react'
import { UserButton } from '@clerk/react'
import { dark } from '@clerk/themes'
import { api, checkHealth, type ServiceKey } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useEntitlements } from '@/hooks/use-entitlements'
import { ThemeToggle } from '@/components/theme-toggle'
import { useTheme } from 'next-themes'
import { ServerDownScreen } from '@/components/server-down-screen'
import { Button } from '@/components/ui/button'
import { ContactButton } from '@/components/contact-button'

const TOP_NAV = [{ label: 'Clients', to: '/', icon: Users }]
const SUPERADMIN_TOP_NAV = [
  { label: 'Overview', to: '/overview', icon: LayoutDashboard },
  { label: 'Audit Tool', to: '/audit-tool', icon: Search },
  { label: 'Prospecting', to: '/prospecting', icon: Target },
]

// Per-client sections. `to` is relative to /clients/:id ('' = the index/home).
// `serviceKey` marks sections gated behind a service. A gated section a client
// isn't entitled to is shown with a lock icon *only if it's something they can
// actually add themselves* (status 'available') — that lock is a working
// upsell. A section granted ONLY by tier ('tier_only', e.g. Local Presence) is
// hidden entirely when not entitled: a locked, un-buyable item is a dead end
// that just confuses (see ClientNav's `hidden`).
interface ClientNavItem {
  label: string
  to: string
  icon: LucideIcon
  serviceKey?: ServiceKey
}
const CLIENT_SECTIONS: ClientNavItem[] = [
  { label: 'Home', to: '', icon: LayoutDashboard },
  { label: 'SEO + AI Visibility', to: 'seo', icon: Search, serviceKey: 'seo' },
  { label: 'Local Presence', to: 'local', icon: MapPin, serviceKey: 'local' },
  { label: 'Chat Assistant', to: 'assistant', icon: Bot, serviceKey: 'chat' },
  { label: 'Leads', to: 'leads', icon: Users },
  { label: 'Content', to: 'content', icon: Sparkles, serviceKey: 'content' },
  { label: 'Paid Ads', to: 'ads', icon: Megaphone, serviceKey: 'ads' },
  { label: 'Requests', to: 'requests', icon: MessageSquarePlus },
  { label: 'Reports', to: 'reports', icon: FileBarChart },
  { label: 'Team', to: 'team', icon: Users2 },
  { label: 'Billing', to: 'billing', icon: CreditCard },
  { label: 'Config', to: 'config', icon: Settings } // includes Connectors — see ConfigSection
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
        const svc = item.serviceKey ? entitlements?.services[item.serviceKey] : undefined
        const entitled = svc?.entitled ?? false
        // Hide a tier-only section the client hasn't unlocked — it can't be
        // added on its own, so a locked entry would be a dead end. Purchasable
        // ('available') sections stay visible-but-locked as an upsell.
        if (item.serviceKey && !entitled && svc?.status === 'tier_only') return null
        const to = item.to ? `${base}/${item.to}` : base
        const active = item.to ? location.pathname === to : location.pathname === base
        const locked = !!item.serviceKey && !entitled
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
        <span className="text-sm font-semibold">Hyperbole Digital</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
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

      {me?.isSuperadmin && (
        <div className="border-t border-border p-3 text-xs text-muted-foreground">
          Superadmin
        </div>
      )}
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

  if (location.pathname === '/prospecting') {
    return (
      <div className="flex items-center gap-2 text-sm">
        <Target className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">Prospecting</span>
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
  const location = useLocation()
  const clientId = location.pathname.match(/^\/clients\/([^/]+)/)?.[1]
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-5">
      <Breadcrumb />
      <div className="flex items-center gap-2">
        {clientId && <ContactButton clientId={clientId} />}
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
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
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
