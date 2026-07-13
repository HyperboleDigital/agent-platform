import type { ReactNode } from 'react'
import { Sparkles, MessageSquarePlus, FileBarChart } from 'lucide-react'
import type { ServiceKey } from '@/lib/api'
import { useEntitlements } from '@/hooks/use-entitlements'
import { useClientCtx } from '@/pages/client/ClientLayout'
import { LockedSection } from '@/components/locked-section'
import { Card, CardContent } from '@/components/ui/card'
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

// Placeholder shown for a section whose feature build lands in a later slice.
// The nav + entitlement wiring is real now; the module UI comes next.
function ComingInBuild({ icon: Icon, title, blurb }: { icon: typeof Sparkles; title: string; blurb: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent">
          <Icon className="h-5 w-5 text-accent-foreground" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="max-w-md text-sm text-muted-foreground">{blurb}</p>
        </div>
      </CardContent>
    </Card>
  )
}

export function ContentSection() {
  return (
    <Gate service="content">
      <ComingInBuild
        icon={Sparkles}
        title="Content Engine"
        blurb="AI-drafted, keyword-targeted blog posts you review and publish land here in the next build."
      />
    </Gate>
  )
}

export function RequestsSection() {
  return (
    <ComingInBuild
      icon={MessageSquarePlus}
      title="Change Requests"
      blurb="Submit and track website change requests here — arriving in an upcoming build."
    />
  )
}

export function ReportsSection() {
  return (
    <ComingInBuild
      icon={FileBarChart}
      title="Reports"
      blurb="Monthly performance reports across SEO, visibility, and chatbot usage land here in an upcoming build."
    />
  )
}
