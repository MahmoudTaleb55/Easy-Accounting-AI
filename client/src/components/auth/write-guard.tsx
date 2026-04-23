import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react"
import { useLocale } from "@/contexts/locale-context"
import { useCurrentRole } from "@/hooks/use-current-role"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function useCanWrite() {
  return useCurrentRole().canWrite
}

export function useCanManageWorkspace() {
  return useCurrentRole().canManageWorkspace
}

export function useReadOnlyMessage() {
  const { locale } = useLocale()
  return locale === "ar"
    ? "ليست لديك صلاحية لتعديل البيانات في هذه المساحة"
    : "You don't have permission to make changes here"
}

export function useOwnerOnlyMessage() {
  const { locale } = useLocale()
  return locale === "ar"
    ? "هذا الإجراء متاح للمالك فقط"
    : "Only the workspace owner can do this"
}

interface GuardProps {
  children: ReactElement<{ disabled?: boolean }>
  /** Optional: when true, the child stays disabled even for users with permission. */
  forceDisabled?: boolean
}

function withGuard(
  children: ReactElement<{ disabled?: boolean }>,
  allowed: boolean,
  forceDisabled: boolean | undefined,
  message: string,
  testId: string,
) {
  if (!isValidElement(children)) return children

  if (allowed) {
    return forceDisabled
      ? cloneElement(children, { disabled: true })
      : children
  }

  const disabledChild = cloneElement(children, { disabled: true })

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex" data-testid={testId}>
          {disabledChild}
        </span>
      </TooltipTrigger>
      <TooltipContent>{message}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Wraps a button-like element so that read-only / viewer members see it
 * disabled with a tooltip explaining why. Owners and accountants see
 * the original element untouched.
 */
export function WriteGuard({ children, forceDisabled }: GuardProps) {
  const canWrite = useCanWrite()
  const message = useReadOnlyMessage()
  return withGuard(children, canWrite, forceDisabled, message, "write-guard-disabled")
}

/**
 * Wraps a button-like element so that only workspace owners can interact
 * with it. Accountants and viewers see it disabled with an owner-only
 * tooltip — used for owner-only screens like Companies, FX rates and
 * workspace settings save.
 */
export function OwnerGuard({ children, forceDisabled }: GuardProps) {
  const canManage = useCanManageWorkspace()
  const message = useOwnerOnlyMessage()
  return withGuard(children, canManage, forceDisabled, message, "owner-guard-disabled")
}

interface OwnerOnlyProps {
  children: ReactNode
  fallback?: ReactNode
}

/**
 * Renders children only when the current user is the workspace owner.
 * Use to fully hide owner-only sections (e.g. the FX rates card) from
 * accountants and viewers, with an optional read-only fallback.
 */
export function OwnerOnly({ children, fallback = null }: OwnerOnlyProps) {
  const canManage = useCanManageWorkspace()
  return <>{canManage ? children : fallback}</>
}
