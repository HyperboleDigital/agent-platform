import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function StatTile({ label, value, className }: { label: string; value: ReactNode; className?: string }) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </Card>
  )
}
