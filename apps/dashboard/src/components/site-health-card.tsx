import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { RefreshCw, ShieldCheck } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

type Variant = 'success' | 'warning' | 'destructive'

function sslVariant(daysRemaining: number | null): Variant {
  if (daysRemaining === null) return 'destructive'
  if (daysRemaining < 14) return 'destructive'
  if (daysRemaining < 30) return 'warning'
  return 'success'
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.round(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

// Care tier's baseline promise — uptime + SSL — shown to every client
// regardless of add-on services. Point-in-time, on-demand: this platform has
// no scheduler, so there's no continuous monitoring or alerting, only "as of
// the last check." See lib/site-health.ts for why.
export function SiteHealthCard({ clientId, domain }: { clientId: string; domain?: string }) {
  const key = ['site-health', clientId]
  const { data: health, isLoading, mutate } = useSWR(key, () => api.clients.siteHealth(clientId))
  const { data: me } = useSWR('me', api.me)
  const isAdmin = !!me?.isSuperadmin
  const [checking, setChecking] = useState(false)

  async function checkNow() {
    setChecking(true)
    try {
      const result = await api.clients.checkSiteHealth(clientId)
      await mutate(result, { revalidate: false })
    } catch (err) {
      toast.error('Site health check failed', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setChecking(false)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-primary" /> Site health</CardTitle>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={checkNow} disabled={checking}>
            <RefreshCw className={checking ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /> Check now
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        {isLoading ? (
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-[60px] w-full" />
            <Skeleton className="h-[60px] w-full" />
          </div>
        ) : !health ? (
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? <>No check has run yet — click "Check now" to see if{domain ? ` ${domain}` : ' the site'} is up and the SSL certificate is valid.</>
              : <>No health check has run yet. We&apos;ll run one shortly.</>}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border border-border p-3">
                <div className="text-xs text-muted-foreground">Uptime</div>
                <div className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                  <Badge variant={health.up ? 'success' : 'destructive'}>
                    <StatusDot variant={health.up ? 'success' : 'destructive'} />
                    {health.up ? 'Up' : 'Down'}
                  </Badge>
                  {health.responseTimeMs !== null && <span className="text-xs text-muted-foreground">{health.responseTimeMs}ms</span>}
                </div>
                {!health.up && health.error && <div className="mt-1 text-xs text-destructive">{health.error}</div>}
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-xs text-muted-foreground">SSL certificate</div>
                {health.sslError ? (
                  <>
                    <div className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                      <Badge variant="destructive"><StatusDot variant="destructive" />Check failed</Badge>
                    </div>
                    <div className="mt-1 text-xs text-destructive">{health.sslError}</div>
                  </>
                ) : !health.ssl ? (
                  <div className="mt-1 text-sm font-medium text-muted-foreground">Not served over HTTPS</div>
                ) : (
                  <div className="mt-1 flex items-center gap-1.5 text-sm font-medium">
                    <Badge variant={sslVariant(health.ssl.daysRemaining)}>
                      <StatusDot variant={sslVariant(health.ssl.daysRemaining)} />
                      {health.ssl.daysRemaining !== null ? `${health.ssl.daysRemaining}d left` : 'Invalid'}
                    </Badge>
                  </div>
                )}
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              Checked {domain ?? 'this site'} · Last checked {timeAgo(health.checkedAt)}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
