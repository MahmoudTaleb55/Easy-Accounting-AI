import { useState, type ReactNode } from "react"
import { Link } from "wouter"
import { useQuery } from "@tanstack/react-query"
import { cn } from "@/lib/utils"
import { useLocale } from "@/contexts/locale-context"
import { ReversedJournalEntryDialog } from "./reversed-journal-entry-dialog"

interface JournalEntryRefLinkProps {
  /** The journal entry id this link points at. */
  id: number
  /** The clickable body — usually a JE reference or short label. */
  children: ReactNode
  /** Class names applied to the live link / reversed button. */
  className?: string
  /** Hover/native title text for the live link. */
  title?: string
  /** Aria-label for the live link. */
  ariaLabel?: string
  /** Stable test-id base. The reversed variant suffixes `-reversed`. */
  "data-testid"?: string
  /**
   * Optional click handler for the live link case. Useful when the parent
   * needs to close a containing dialog before letting wouter navigate.
   * Not invoked in the reversed branch — clicking opens the local
   * tombstone instead of navigating.
   */
  onLiveClick?: () => void
  /**
   * Render the "reversed" hint badge after the body. Default true. Pages
   * that use a very tight layout (e.g. a narrow table column) can opt out
   * to keep the cell from wrapping; the strikethrough on the body and the
   * tooltip still communicate the state.
   */
  showReversedHint?: boolean
}

interface JEListItem {
  id: number
}

// A drop-in replacement for `<Link href="/app/journal#je-<id>">…</Link>`.
//
// Behaviour:
//   * If the JE id is present in the live `/api/journal-entries` cache, it
//     renders an ordinary deep-link to the JE page. This preserves the
//     existing scroll-into-view + highlight flow on the destination.
//   * If the JE id is missing from the live list (because a
//     `reverseAutoPostedJournalEntry` cascade has deleted the row), the
//     same body is rendered inside a button with a strikethrough + a small
//     "reversed" hint. Clicking opens a local `ReversedJournalEntryDialog`
//     that fetches `/api/audit/journal_entry/:id/with-reversal` and shows
//     the audit trail without forcing a navigation.
//   * While the entries query is loading (or has failed), the link falls
//     back to the live-link rendering. The destination JE page handles the
//     same tombstone fallback, so the worst case is the dialog appears one
//     navigation later — never a 404.
//
// Why use the cached `/api/journal-entries` list instead of a per-id
// liveness probe: every page that already needs the live JE list shares
// this cache, so most surfaces incur zero extra HTTP. Pages that don't
// already load it (e.g. transactions, fixed-assets) trigger a single
// shared fetch which is fine for the small dataset and gives us a
// synchronous answer for every JE chip on the page.
export function JournalEntryRefLink({
  id,
  children,
  className,
  title,
  ariaLabel,
  onLiveClick,
  showReversedHint = true,
  ...rest
}: JournalEntryRefLinkProps) {
  const testId = rest["data-testid"]
  const { locale } = useLocale()
  const ar = locale === "ar"
  const [tombstoneOpen, setTombstoneOpen] = useState(false)

  const { data: entries } = useQuery<JEListItem[]>({
    queryKey: ["/api/journal-entries"],
  })

  // Treat "data not loaded yet" as live so we never block the click.
  // Once the cache populates and confirms the id is gone, the chip
  // re-renders in its reversed state.
  const reversed = !!entries && !entries.some((e) => e.id === id)

  if (!reversed) {
    return (
      <Link
        href={`/app/journal#je-${id}`}
        className={className}
        title={title}
        aria-label={ariaLabel}
        data-testid={testId}
        onClick={onLiveClick}
      >
        {children}
      </Link>
    )
  }

  const reversedHintLabel = ar ? "محذوف" : "reversed"
  const reversedTitle = ar
    ? "تم عكس هذا القيد. اضغط لعرض الأثر."
    : "This entry was reversed. Click to view the trail."

  return (
    <>
      <button
        type="button"
        onClick={() => setTombstoneOpen(true)}
        // Override the colored hover/underline of the wrapped link
        // styling so a deleted reference reads as "tombstoned" rather
        // than as a live, clickable record. The strikethrough is the
        // primary visual cue; the appended hint badge is the textual one.
        className={cn(
          className,
          "line-through decoration-muted-foreground/60 text-muted-foreground hover:text-foreground hover:no-underline focus-visible:no-underline",
        )}
        title={reversedTitle}
        aria-label={ariaLabel ? `${ariaLabel} — ${reversedTitle}` : reversedTitle}
        data-testid={testId ? `${testId}-reversed` : "link-je-reversed"}
        data-reversed="true"
      >
        {children}
        {showReversedHint && (
          <span
            className="ms-1.5 inline-flex items-center rounded-sm bg-muted px-1 py-0 text-[9px] font-medium uppercase tracking-wide text-muted-foreground no-underline align-middle"
            aria-hidden="true"
          >
            {reversedHintLabel}
          </span>
        )}
      </button>
      {tombstoneOpen && (
        <ReversedJournalEntryDialog
          entryId={id}
          onClose={() => setTombstoneOpen(false)}
        />
      )}
    </>
  )
}
