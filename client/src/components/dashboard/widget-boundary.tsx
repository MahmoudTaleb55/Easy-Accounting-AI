import { Suspense, Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle } from "lucide-react";

interface State {
  error: Error | null;
}

class WidgetErrorBoundary extends Component<
  { children: ReactNode; label?: string },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[dashboard widget error]", this.props.label, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="border border-destructive/30 bg-destructive/5 text-destructive rounded-md p-4 text-xs flex items-start gap-2"
          data-testid="widget-error"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            <div className="font-medium">
              {this.props.label
                ? `${this.props.label} couldn't load`
                : "Widget couldn't load"}
            </div>
            <div className="text-destructive/80 text-[11px] truncate max-w-md">
              {this.state.error.message}
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * WidgetBoundary isolates each dashboard widget so that:
 *   - A slow endpoint never blocks siblings (Suspense fallback shows the
 *     widget-shaped skeleton, not a blank area).
 *   - A thrown error in one widget is caught and shown inline, so the rest
 *     of the dashboard keeps working.
 */
export function WidgetBoundary({
  fallback,
  label,
  children,
}: {
  fallback: ReactNode;
  label?: string;
  children: ReactNode;
}) {
  return (
    <WidgetErrorBoundary label={label}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </WidgetErrorBoundary>
  );
}
