import { cva } from "class-variance-authority";
import type { ReactNode } from "react";
import { cn } from "../lib/utils.js";
import type { NoSemanticState } from "../types/forbidden-brand.js";

/**
 * Static callout for inline messaging.
 *
 * `tone` is semantic STYLE — it selects which color tokens paint the callout —
 * not semantic state: the component knows nothing about why the message exists
 * (no fetch/error/result props; the information-state firewall forbids them).
 * The caller decides the tone; this component only renders it.
 *
 * Accessibility: `role="alert"` only when `tone` is `danger` (assertive
 * announcement); every other tone renders `role="status"` (polite).
 */
const alertVariants = cva("rounded-lg border p-4 text-sm text-foreground", {
  variants: {
    tone: {
      info: "border-info/50 bg-info/10",
      success: "border-success/50 bg-success/10",
      warning: "border-warning/50 bg-warning/10",
      danger: "border-destructive/50 bg-destructive/10",
    },
  },
  defaultVariants: {
    tone: "info",
  },
});

export type AlertTone = "info" | "success" | "warning" | "danger";

export type AlertProps = NoSemanticState<{
  tone?: AlertTone;
  title?: string;
  children: ReactNode;
  className?: string;
}>;

export function Alert({
  tone = "info",
  title,
  children,
  className,
}: AlertProps) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(alertVariants({ tone }), className)}
    >
      {title ? <p className="font-medium mb-1">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}

export { alertVariants };
