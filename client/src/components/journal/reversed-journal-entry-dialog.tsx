import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { HistoryTimeline } from "@/components/audit/history-drawer"
import { useT } from "@/i18n/dict"

interface ReversedJournalEntryDialogProps {
  entryId: number
  onClose: () => void
}

// Tombstone dialog for a journal entry that was cascade-deleted by a
// `reverseAutoPostedJournalEntry` call. The drawer body re-uses the same
// `HistoryTimeline` as the live JE detail dialog, but is mounted with
// `includeReversal` so it reads the audit log via the reversal-aware
// endpoint instead of the standard one (which would 404).
//
// Originally lived inside `client/src/pages/journal-entries.tsx` as a
// private component. Lifted into its own file so any place that links to
// a JE id (`SourceLinkBadge`, the transactions detail, the inbox/HR/fixed-asset
// tables, the chart-of-accounts ledger drawer, the AI assistant artifact card)
// can render the same fallback inline when its target JE has been reversed.
export function ReversedJournalEntryDialog({
  entryId,
  onClose,
}: ReversedJournalEntryDialogProps) {
  const t = useT()
  const labels = {
    title: t("journal_rev_title"),
    description: t("journal_rev_desc"),
    notFound: t("journal_rev_not_found"),
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="sm:max-w-2xl max-h-[90vh] overflow-y-auto"
        data-testid="dialog-entry-reversed"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="font-numeric text-[11px] tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
              JE #{entryId}
            </span>
            <span className="truncate">{labels.title}</span>
          </DialogTitle>
          <DialogDescription>{labels.description}</DialogDescription>
        </DialogHeader>
        <div
          className="rounded-md border border-border max-h-[60vh] overflow-hidden flex flex-col mt-2"
          data-testid="reversed-entry-history"
        >
          <HistoryTimeline
            entityType="journal_entry"
            entityId={entryId}
            includeReversal
            emptyLabel={labels.notFound}
            className="flex-1 min-h-0"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
