import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      variant: {
        default: 'bg-brand-50 text-brand-700 dark:bg-brand-950/30 dark:text-brand-400',
        secondary: 'bg-muted text-muted-foreground',
        success: 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400',
        warning: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/50 dark:text-yellow-400',
        danger: 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400',
        info: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-400',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
