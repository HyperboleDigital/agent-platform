import * as React from 'react'
import { cva } from 'class-variance-authority'
import type { VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/15 text-primary',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        success: 'border-transparent bg-success/15 text-success',
        warning: 'border-transparent bg-warning/15 text-warning',
        destructive: 'border-transparent bg-destructive/15 text-destructive',
        outline: 'border-border text-foreground'
      }
    },
    defaultVariants: { variant: 'default' }
  }
)

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

// Small colored dot to pair with a status label, e.g. <StatusDot variant="success" /> Active
export function StatusDot({ variant }: { variant: 'default' | 'success' | 'warning' | 'destructive' | 'secondary' }) {
  const color = {
    default: 'bg-primary', success: 'bg-success', warning: 'bg-warning',
    destructive: 'bg-destructive', secondary: 'bg-muted-foreground'
  }[variant]
  return <span className={cn('inline-block h-1.5 w-1.5 rounded-full', color)} />
}
