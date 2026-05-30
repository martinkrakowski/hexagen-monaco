import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Render in an error state (red border + aria-invalid). */
  invalid?: boolean;
}

/**
 * Text input stub. Token-driven border and focus ring; sets aria-invalid so
 * forms and screen readers stay in sync with the visual error state.
 */
export function Input(props: InputProps): ReactNode {
  const { className, invalid = false, ...rest } = props;
  return (
    <input
      className={cn(
        "h-10 w-full rounded-md border bg-background px-3 text-sm text-text-primary",
        "placeholder:text-text-muted",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        invalid ? "border-error" : "border-border",
        className,
      )}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  );
}
