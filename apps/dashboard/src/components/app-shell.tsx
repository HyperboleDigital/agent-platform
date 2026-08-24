import { useState, useEffect } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import useSWR from 'swr'
import { toast } from 'sonner'
import type { LucideIcon } from 'lucide-react'
import {
  Users, Sparkles, LayoutDashboard, Search, Bot,
  MessageSquarePlus, FileBarChart, CreditCard, Settings, Lock, Building2, MapPin, Target, Megaphone, Users2,
  Menu, X, ListChecks } from 'lucide-react'
import { UserButton } from '@clerk/react'
import { dark } from '@clerk/themes'
import { api, checkHealth, type ServiceKey } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useEntitlements } from '@/hooks/use-entitlements'
import { useClientBySlug } from '@/hooks/use-client-by-slug'
import { ServerDownScreen } from '@/components/server-down-screen'
import { Button } from '@/components/ui/button'
import { ContactButton } from '@/components/contact-button'
import hyperboleWordmark from '@/img/hyperbole-wordmark.png'

const TOP_NAV = [{ label: 'Clients', to: '/', icon: Users }]
const SUPERADMIN_TOP_NAV = [
  { label: 'Overview', to: '/overview', icon: LayoutDashboard },
  { label: 'Audit Tool', to: '/audit-tool', icon: Search },
  { label: 'Prospecting', to: '/prospecting', icon: Target },
  { label: 'Jobs', to: '/jobs', icon: ListChecks },
]

// Per-client sections. `to` is relative to /clients/:id ('' = the index/home).
// `serviceKey` marks sections gated behind a service. For CLIENTS the rule is
// absolute and enforced in one place (ClientNav below): a service section
// renders only when the client is entitled to it. No teaser states, no locked
// items with upgrade prompts — an unpurchased service simply doesn't exist in
// their nav. (The upsell surface is the report + the contact CTA, not a dead
// padlock.) Superadmins see every section for every client; a lock glyph marks
// the ones this client isn't entitled to, as an at-a-glance entitlement map.
// `superadminOnly` marks internal agency tooling we operate on the client's
// behalf rather than something they use themselves — hidden from them entirely
// (the route is guarded by <AdminOnly>, since hiding a link isn't access
// control).
interface ClientNavItem {
  label: string
  to: string
  icon: LucideIcon
  serviceKey?: ServiceKey
  superadminOnly?: boolean
}
const CLIENT_SECTIONS: ClientNavItem[] = [
  { label: 'Home', to: '', icon: LayoutDashboard },
  { label: 'SEO + AI Visibility', to: 'seo', icon: Search, serviceKey: 'seo' },
  { label: 'Local Presence', to: 'local', icon: MapPin, serviceKey: 'local' },
  { label: 'Chat Assistant', to: 'assistant', icon: Bot, serviceKey: 'chat' },
  // Leads exist only via the chat agent's CRM tool (tools/crm.ts), so the
  // section is part of the chat service, not a universal one.
  { label: 'Leads', to: 'leads', icon: Users, serviceKey: 'chat' },
  { label: 'Content', to: 'content', icon: Sparkles, serviceKey: 'content', superadminOnly: true },
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

// Client section nav, shown when inside /clients/:slug/* — with lock icons on
// sections the client isn't entitled to.
function ClientNav({ slug }: { slug: string }) {
  const location = useLocation()
  const { data: client } = useClientBySlug(slug)
  const { entitlements } = useEntitlements(client?.id)
  const { data: me } = useSWR('me', api.me)
  const base = `/clients/${slug}`

  return (
    <>
      {CLIENT_SECTIONS.map(item => {
        // Internal tooling — never shown to a client.
        if (item.superadminOnly && !me?.isSuperadmin) return null
        const entitled = item.serviceKey ? (entitlements?.services[item.serviceKey]?.entitled ?? false) : true
        // The one nav-entitlement rule: clients only ever see sections they're
        // entitled to. Superadmins see everything, with a lock marking what
        // this client doesn't have.
        if (!entitled && !me?.isSuperadmin) return null
        const to = item.to ? `${base}/${item.to}` : base
        const active = item.to ? location.pathname === to : location.pathname === base
        const locked = !entitled
        return <NavLink key={item.label} to={to} active={active} icon={item.icon} label={item.label} locked={locked} />
      })}
    </>
  )
}

// The nav itself, shared by the desktop sidebar and the mobile drawer so the
// two can never drift out of sync.
function NavBody() {
  const location = useLocation()
  const { data: me } = useSWR('me', api.me)

  // Which client's sections to show (if any) — parsed from the URL so the shell
  // (a layout above the routed match) can react to it. This is the SLUG
  // segment now, not the client's id — see ClientNav/useClientBySlug.
  const slug = location.pathname.match(/^\/clients\/([^/]+)/)?.[1]
  const topNav = me?.isSuperadmin ? [...SUPERADMIN_TOP_NAV, ...TOP_NAV] : TOP_NAV

  return (
    <>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {slug ? (
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
            <ClientNav slug={slug} />
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
    </>
  )
}

function Sidebar() {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
      <div className="flex h-14 items-center border-b border-border px-5">
        <img src={hyperboleWordmark} alt="Hyperbole Digital" className="h-4 w-auto" />
      </div>
      <NavBody />
    </aside>
  )
}

// Below `md` the sidebar is hidden, so without this there is no navigation at
// all on a narrow screen — you could reach a page but never leave it. Renders
// the same NavBody in a slide-in drawer, and is itself hidden at `md`+ where
// the real sidebar takes over.
function MobileNav() {
  const [open, setOpen] = useState(false)
  const location = useLocation()

  // Tapping a nav link navigates but doesn't unmount the drawer — close it on
  // any route change so it never covers the page you just asked for.
  useEffect(() => { setOpen(false) }, [location.pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open])

  return (
    <div className="md:hidden">
      <button
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="flex h-full w-64 max-w-[85vw] flex-col border-r border-border bg-card shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
              <img src={hyperboleWordmark} alt="Hyperbole Digital" className="h-4 w-auto" />
              <button
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <NavBody />
          </div>
        </div>
      )}
    </div>
  )
}

// Shows what you're currently looking at — the client name (+ section) when
// inside /clients/:id/*, or a platform-level label otherwise. Otherwise this
// header space just sits empty.
function Breadcrumb() {
  const location = useLocation()
  const slug = location.pathname.match(/^\/clients\/([^/]+)/)?.[1]
  const { data: client } = useClientBySlug(slug)

  if (slug) {
    const section = CLIENT_SECTIONS.find(item => {
      const to = item.to ? `/clients/${slug}/${item.to}` : `/clients/${slug}`
      return location.pathname === to
    })
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm">
        {client?.logoUrl ? (
          <img src={client.logoUrl} alt="" className="h-4 w-4 shrink-0 rounded-sm object-contain" />
        ) : (
          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate font-medium">{client?.name ?? 'Loading…'}</span>
        {/* The section name is the first thing to go when space is tight —
            the sidebar/drawer already shows where you are. */}
        {section && section.to && <span className="hidden truncate text-muted-foreground sm:inline">/ {section.label}</span>}
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
  const location = useLocation()
  const slug = location.pathname.match(/^\/clients\/([^/]+)/)?.[1]
  const { data: client } = useClientBySlug(slug)
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4 md:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <MobileNav />
        <Breadcrumb />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {/* The contact CTA is a nice-to-have next to a cramped breadcrumb —
            it stays reachable on mobile from the client's own pages. */}
        {client?.id && <span className="hidden sm:inline-flex"><ContactButton clientId={client.id} /></span>}
        {/* No theme toggle — the dashboard is dark-mode only, see index.html's hardcoded class="dark". */}
        <UserButton appearance={{ baseTheme: dark } as never} />
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
