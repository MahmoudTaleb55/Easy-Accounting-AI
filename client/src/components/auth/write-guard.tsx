import { cloneElement, isValidElement, type ReactElement } from "react"
import { useAuth } from "@/hooks/use-auth"
import { useLocale } from "@/contexts/locale-context"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function useCanWrite() {
  const { can } = useAuth()
  return can.write
}

export function useReadOnlyMessage() {
  const { locale } = useLocale()
  return locale === "ar"
    ? "ليست لديك صلاحية لتعديل البيانات في هذه المساحة"
    : "You don't have permission to make changes here"
}

interface WriteGuardProps {
  children: ReactElement<{ disabled?: boolean }>
  /** Optional: when true, the child stays disabled even for users with write permission. */
  forceDisabled?: boolean
}

/**
 * Wraps a button-like element so that read-only / reviewer members see it
 * disabled with a tooltip explaining why. Admin and accountant members see
 * the original element untouched.
 */
export function WriteGuard({ children, forceDisabled }: WriteGuardProps) {
  const canWrite = useCanWrite()
  const message = useReadOnlyMessage()

  if (!isValidElement(children)) return children

  if (canWrite) {
    return forceDisabled
      ? cloneElement(children, { disabled: true })
      : children
  }

  const disabledChild = cloneElement(children, { disabled: true })

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex" data-testid="write-guard-disabled">
          {disabledChild}
        </span>
      </TooltipTrigger>
      <TooltipContent>{message}</TooltipContent>
    </Tooltip>
  )
}
