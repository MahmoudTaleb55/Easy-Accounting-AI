import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void; testId?: string };
  secondary?: { label: string; onClick: () => void; testId?: string };
  caption?: string;
  className?: string;
  testId?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondary,
  caption,
  className,
  testId,
}: EmptyStateProps) {
  return (
    <Card
      variant="default"
      className={cn(
        "px-6 py-12 sm:py-16 flex flex-col items-center text-center",
        className
      )}
      data-testid={testId || "empty-state"}
    >
      {icon && (
        <div className="mx-auto mb-4 inline-flex items-center justify-center w-11 h-11 rounded-md bg-muted/60 border border-border text-muted-foreground">
          {icon}
        </div>
      )}
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-1.5 text-sm text-muted-foreground max-w-sm">
          {description}
        </p>
      )}
      {(action || secondary) && (
        <div className="mt-5 flex items-center gap-2 flex-wrap justify-center">
          {action && (
            <Button
              size="sm"
              onClick={action.onClick}
              data-testid={action.testId || "empty-state-action"}
            >
              {action.label}
            </Button>
          )}
          {secondary && (
            <Button
              size="sm"
              variant="ghost"
              onClick={secondary.onClick}
              data-testid={secondary.testId || "empty-state-secondary"}
            >
              {secondary.label}
            </Button>
          )}
        </div>
      )}
      {caption && (
        <p className="mt-4 text-[11px] uppercase tracking-wider text-muted-foreground/70 font-mono">
          {caption}
        </p>
      )}
    </Card>
  );
}
