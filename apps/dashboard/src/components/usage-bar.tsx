import { cn } from '@/lib/utils'
import type { MonthlyUsage } from '@/lib/api'

export function UsageBar({ usage }: { usage: MonthlyUsage }) {
  const pct = usage.cap > 0 ? Math.min(100, (usage.used / usage.cap) * 100) : 0
  const nearCap = pct >= 80
  const overCap = pct >= 100

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium">
          {usage.used.toLocaleString()} <span className="text-muted-foreground">/ {usage.cap.toLocaleString()} conversations</span>
        </span>
        <span className="text-xs text-muted-foreground">{usage.planName ?? 'No plan'} · this month</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all',
            overCap ? 'bg-destructive' : nearCap ? 'bg-warning' : 'bg-primary'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {overCap && <p className="text-xs text-destructive">Over your plan's monthly limit — consider upgrading.</p>}
      {!overCap && nearCap && <p className="text-xs text-warning">Approaching your monthly limit.</p>}
    </div>
  )
}
