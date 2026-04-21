import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap select-none",
    "rounded-md font-medium",
    "transition-[background-color,box-shadow,border-color,color] duration-150 ease-out",
    "focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        // Solid brand action — deep emerald, hairline darker border for depth
        default:
          "bg-primary text-primary-foreground border border-primary-border shadow-xs hover:bg-primary/92 active:bg-primary",
        // Destructive — same treatment, red
        destructive:
          "bg-destructive text-destructive-foreground border border-destructive-border shadow-xs hover:bg-destructive/92 active:bg-destructive",
        // Outline — quiet, inherits surface bg
        outline:
          "border border-input bg-transparent text-foreground shadow-xs hover:bg-accent/60 hover:border-border active:bg-accent",
        // Secondary — soft neutral fill
        secondary:
          "bg-secondary text-secondary-foreground border border-secondary-border hover:bg-secondary/80",
        // Ghost — no chrome until hover
        ghost:
          "border border-transparent text-foreground hover:bg-accent/60",
        // Link — text-only inline action
        link:
          "border border-transparent text-primary underline-offset-4 hover:underline",
        // Subtle brand — accent fill (used for secondary brand actions on light surfaces)
        subtle:
          "bg-accent text-accent-foreground border border-accent-border hover:bg-accent/80",
      },
      // Heights use `min-h-*` so buttons gracefully expand to fit long or
      // multiline labels (preserves prior behavior).
      size: {
        sm:      "min-h-8 rounded-sm px-3 py-1.5 text-xs gap-1.5 [&_svg]:size-3.5",
        default: "min-h-9 px-4 py-2 text-sm",
        lg:      "min-h-11 px-6 py-2.5 text-sm",
        xl:      "min-h-12 px-7 py-3 text-base rounded-lg",
        icon:    "h-9 w-9 [&_svg]:size-4",
        "icon-sm": "h-8 w-8 [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
