import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Surface
          "flex w-full h-9 bg-card border border-input rounded-md",
          // Spacing & type
          "px-3 py-2 text-sm leading-none text-foreground",
          // Tabular figures inside numeric fields by default
          "tabular-nums",
          // File input slot
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          // Placeholder
          "placeholder:text-muted-foreground/70",
          // Interaction
          "transition-[border-color,box-shadow,background-color] duration-150",
          "hover:border-border focus-visible:outline-none focus-visible:border-primary/60",
          // Disabled
          "disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-muted",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
