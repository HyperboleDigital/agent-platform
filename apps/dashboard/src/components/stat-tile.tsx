import type { ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// `info` renders a small (i) beside the label explaining what the number
// actually measures. Worth writing whenever the unit is easy to mistake —
// messages vs conversations is the canonical case (see lib/usage.ts's
// two-units note on the API side). The trigger is a real button, so it works
// by tap/focus on touch screens, not just hover.
export function StatTile({ label, value, info, className }: {
  label: string
  value: ReactNode
  info?: string
  className?: string
}) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {info && (
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label={`What "${label}" means`} className="cursor-help">
                  <Info className="h-3 w-3 opacity-60 transition-opacity hover:opacity-100" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{info}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </Card>
  )
}
