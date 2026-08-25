import { useState } from 'react'
import useSWR from 'swr'
import { Link, useParams } from 'react-router-dom'
import { CheckCircle2, Circle, ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// Onboarding setup checklist banner (handoff #3 §2) — sits at the top of the
// SEO page so a half-set-up client can't be silently under-delivered. Red
// items link to the screen where the fix lives; fully complete collapses to a
// single green line.
export function SetupBanner({ clientId }: { clientId: string }) {
  const { slug = '' } = useParams()
  const { data: status } = useSWR(['setup-status', clientId], () => api.clients.setupStatus(clientId))
  const [expanded, setExpanded] = useState<boolean | null>(null) // null = follow completeness

  if (!status) return null

  const open = expanded ?? !status.complete

  return (
    <Card className={status.complete ? 'border-success/40' : 'border-warning/50'}>
      <CardContent className="p-3">
        <button
          type="button"
          className="flex w-full items-center gap-2 text-left text-sm font-medium"
          onClick={() => setExpanded(!open)}
        >
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          {status.complete ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-success" /> Setup complete
            </>
          ) : (
            <>
              Setup incomplete
              <Badge variant="warning">{status.incompleteCount} item{status.incompleteCount === 1 ? '' : 's'} left</Badge>
            </>
          )}
        </button>
        {open && (
          <ul className="mt-2 flex flex-col gap-1.5 pl-6">
            {status.required.map(item => (
              <li key={item.key} className="flex items-start gap-2 text-sm">
                {item.complete
                  ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />}
                <span>
                  {item.complete ? (
                    <span>{item.label}</span>
                  ) : (
                    <Link to={`/clients/${slug}/${item.section}`} className="underline underline-offset-2 hover:text-foreground">
                      {item.label}
                    </Link>
                  )}
                  {item.detail && <span className="ml-2 text-xs text-muted-foreground">{item.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
