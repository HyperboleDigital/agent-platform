import { Outlet, Link, useLocation } from 'react-router-dom'
import useSWR from 'swr'
import { Users, Sparkles, LayoutDashboard } from 'lucide-react'
import { UserButton } from '@clerk/react'
import { dark } from '@clerk/themes'
import { api, checkHealth } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ThemeToggle } from '@/components/theme-toggle'
import { useTheme } from 'next-themes'
import { ServerDownScreen } from '@/components/server-down-screen'

const NAV = [{ label: 'Clients', to: '/', icon: Users }]
const SUPERADMIN_NAV = [{ label: 'Overview', to: '/overview', icon: LayoutDashboard }]

function Sidebar() {
  const location = useLocation()
  const { data: me } = useSWR('me', api.me)
  const nav = me?.isSuperadmin ? [...SUPERADMIN_NAV, ...NAV] : NAV

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
      <div className="flex h-14 items-center gap-2 border-b border-border px-5">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Agent Platform</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 p-3">
        {nav.map(item => {
          const active = location.pathname === item.to
          const Icon = item.icon
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-border p-3 text-xs text-muted-foreground">
        {me?.isSuperadmin ? 'Superadmin' : me?.orgId ? 'Client account' : 'No client linked'}
      </div>
    </aside>
  )
}

function Topbar() {
  const { theme } = useTheme()
  return (
    <header className="flex h-14 shrink-0 items-center justify-end gap-2 border-b border-border px-5">
      <ThemeToggle />
      <UserButton appearance={{ baseTheme: theme === 'light' ? undefined : dark } as never} />
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
