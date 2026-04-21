import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Table — refined for accounting / financial data.
 * - Headers: small, uppercase, tracked, muted (eyebrow style)
 * - Numbers: tabular figures globally (set via :where rule in index.css)
 * - Rows: hairline separators, very subtle hover
 * - Density: compact by default; pass `density="comfortable"` for breathable layouts
 */

type Density = "compact" | "comfortable"

interface TableProps extends React.HTMLAttributes<HTMLTableElement> {
  density?: Density
}

const Table = React.forwardRef<HTMLTableElement, TableProps>(
  ({ className, density = "compact", ...props }, ref) => (
    <div className="relative w-full overflow-auto">
      <table
        ref={ref}
        data-density={density}
        className={cn(
          "w-full caption-bottom text-sm tabular-nums",
          "[&[data-density=compact]_td]:py-2.5 [&[data-density=compact]_th]:py-2.5",
          "[&[data-density=comfortable]_td]:py-4 [&[data-density=comfortable]_th]:py-3",
          // Numeric column helper — opt in via `.numeric` on td/th
          "[&_td.numeric]:font-numeric [&_td.numeric]:text-end",
          "[&_th.numeric]:font-numeric [&_th.numeric]:text-end",
          className
        )}
        {...props}
      />
    </div>
  )
)
Table.displayName = "Table"

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      "border-b border-border bg-muted/30 [&_tr]:border-0",
      className
    )}
    {...props}
  />
))
TableHeader.displayName = "TableHeader"

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn("[&_tr:last-child]:border-0", className)}
    {...props}
  />
))
TableBody.displayName = "TableBody"

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t border-border bg-muted/40 font-medium text-foreground [&>tr]:last:border-b-0",
      className
    )}
    {...props}
  />
))
TableFooter.displayName = "TableFooter"

const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "border-b border-border/70 transition-colors",
      "hover:bg-accent/40 data-[state=selected]:bg-accent/60",
      className
    )}
    {...props}
  />
))
TableRow.displayName = "TableRow"

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      // Eyebrow-style header: small, uppercase, tracked, muted
      "px-4 text-start align-middle text-2xs font-medium uppercase tracking-widest text-muted-foreground",
      "[&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
))
TableHead.displayName = "TableHead"

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      "px-4 align-middle text-foreground/90 [&:has([role=checkbox])]:pr-0",
      className
    )}
    {...props}
  />
))
TableCell.displayName = "TableCell"

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-4 text-sm text-muted-foreground", className)}
    {...props}
  />
))
TableCaption.displayName = "TableCaption"

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
