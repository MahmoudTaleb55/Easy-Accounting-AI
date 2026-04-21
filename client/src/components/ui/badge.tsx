import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Badge — tonal pill with status semantics.
 * Tonal variants use a soft tinted background + readable foreground,
 * matching premium fintech UIs (Mercury/Linear) instead of solid bright fills.
 */
const badgeVariants = cva(
  "inline-flex items-center whitespace-nowrap rounded-md border font-medium transition-colors",
  {
    variants: {
      variant: {
        default:     "bg-foreground text-background border-transparent",
        secondary:   "bg-secondary text-secondary-foreground border-secondary-border",
        outline:     "bg-transparent text-foreground border-border",
        // Tonal status pills
        success:     "bg-success/10 text-success border-success/20",
        warning:     "bg-warning/10 text-warning border-warning/20",
        info:        "bg-info/10 text-info border-info/20",
        destructive: "bg-destructive/10 text-destructive border-destructive/20",
        brand:       "bg-accent text-accent-foreground border-accent-border",
        muted:       "bg-muted text-muted-foreground border-muted-border",
        // Accounting semantics
        income:      "bg-income/10 text-income border-income/20",
        expense:     "bg-expense/10 text-expense border-expense/20",
      },
      size: {
        sm: "h-5 px-1.5 text-2xs gap-1 [&_svg]:size-3",
        md: "h-6 px-2 text-xs gap-1.5 [&_svg]:size-3.5",
        lg: "h-7 px-2.5 text-sm gap-1.5 [&_svg]:size-4",
      },
    },
    defaultVariants: {
      variant: "secondary",
      size: "md",
    },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant, size }), className)} {...props} />
  );
}

export { Badge, badgeVariants }
