import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { CheckCircle2, AlertTriangle, XCircle, MinusCircle, Gauge, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api, type BaselineCheck, type BaselineStatus } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

// The Care tier's "technical SEO baseline" bullet, rendered for the client.
//
// Lives on Home rather than inside the SEO section because Care includes no
// services — the SEO section is locked for exactly the clients this is meant
// for. See lib/site-baseline.ts on the API for where the numbers come from.

const STATUS_UI: Record<BaselineStatus, { icon: typeof CheckCircle2; className: string; label: string }> = {
  good: { icon: CheckCircle2, className: 'text-emerald-500', label: 'Good' },
  warn: { icon: AlertTriangle, className: 'text-amber-500', label: 'Needs a look' },
  poor: { icon: XCircle, className: 'text-destructive', label: 'Needs fixing' },
  // Visually distinct from 'good' on purpose: an unmeasured check must never
  // read as a passing one.
  unknown: { icon: MinusCircle, className: 'text-muted-foreground/50', label: 'Not checked' },
}

function CheckRow({ check }: { check: BaselineCheck }) {
  const ui = STATUS_UI[check.status]
  const Icon = ui.icon
  return (
    <div className="flex gap-2.5 border-b border-border py-2.5 last:border-0">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ui.className}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-medium">{check.label}</span>
          {check.score != null && <span className="text-xs text-muted-foreground">{check.score}/100</span>}
        </div>
        <p className="text-xs text-muted-foreground">{check.detail}</p>
        {check.findings.length > 0 && (
          <ul className="mt-1 flex flex-col gap-0.5">
            {check.findings.map((f, i) => (
              <li key={i} className="text-xs text-muted-foreground/80">— {f}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export function SiteBaselineCard({ clientId, domain }: { clientId: string; domain?: string }) {
  const key = clientId ? ['baseline', clientId] : null
  const { data: baseline, isLoading } = useSWR(key, () => api.clients.baseline(clientId))
  const [running, setRunning] = useState(false)

  async function run() {
    setRunning(true)
    try {
      await api.clients.runBaseline(clientId)
      await mutate(key)
      toast.success('Site check complete')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Site check failed')
    } finally {
      setRunning(false)
    }
  }

  // A client with no domain can't be checked at all; showing an empty card
  // with a dead button would just look broken.
  if (!domain) return null

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Gauge className="h-4 w-4" />Site health check
        </CardTitle>
        <Button variant="outline" size="sm" onClick={run} disabled={running}>
          <RefreshCw className={`h-3.5 w-3.5 ${running ? 'animate-spin' : ''}`} />
          {running ? 'Checking…' : 'Run check'}
        </Button>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" />
          </div>
        ) : !baseline ? (
          <p className="text-sm text-muted-foreground">
            No check has run yet. It looks at page speed, mobile friendliness, page titles and
            descriptions, and whether search engines can index the site — takes about a minute.
          </p>
        ) : (
          <>
            <div className="flex flex-col">
              {baseline.checks.map(c => <CheckRow key={c.key} check={c} />)}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Last checked {new Date(baseline.createdAt).toLocaleDateString()} · {baseline.url}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
