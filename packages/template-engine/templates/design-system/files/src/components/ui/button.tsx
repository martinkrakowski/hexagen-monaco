import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-primary text-white hover:bg-brand-primary-hover focus-visible:ring-brand-primary",
  secondary:
    "bg-surface text-text-primary border border-border hover:bg-border/40",
  ghost: "bg-transparent text-text-primary hover:bg-surface",
  destructive: "bg-error text-white hover:opacity-90",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

/**
 * Base button. A skeletal pattern (variants + cn() + a11y) to extend, not a
 * polished component. Disabled while loading; exposes a spinner slot.
 */
export function Button(props: ButtonProps): ReactNode {
  const {
    variant = "primary",
    size = "md",
    isLoading = false,
    className,
    children,
    disabled,
    ...rest
  } = props;

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        "disabled:pointer-events-none disabled:opacity-50",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...rest}
    >
      {isLoading ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
      {isLoading ? null : children}
    </button>
  );
}
