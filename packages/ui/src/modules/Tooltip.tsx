import type {
  HTMLAttributes,
  ForwardRefRenderFunction,
  ReactNode,
} from "react";
import { forwardRef, useId } from "react";
import { cn } from "../lib/utils.js";
import { useDisclosure } from "../controllers/useDisclosure.js";
import type { NoSemanticState } from "../types/forbidden-brand.js";

export interface TooltipProps extends NoSemanticState<
  Omit<HTMLAttributes<HTMLSpanElement>, "content">
> {
  /** The tooltip body shown on hover/focus. */
  content: ReactNode;
  /** The trigger; wrapped in a focusable element so the tooltip is keyboard-reachable. */
  children: ReactNode;
  /** Which side of the trigger the tooltip floats to. */
  side?: "top" | "bottom";
  /** Accessible label for the trigger when its visible content isn't descriptive. */
  ariaLabel?: string;
}

/**
 * Hover- and keyboard-accessible tooltip. Presentation-only: the trigger is a
 * focusable inline wrapper that exposes the tooltip via `aria-describedby`, and
 * the content carries `role="tooltip"`. Opens on pointer enter / focus, closes
 * on pointer leave / blur / Escape.
 *
 * No positioning library: the content is absolutely positioned relative to the
 * trigger (top by default). Composed from `useDisclosure`.
 */
const TooltipRender: ForwardRefRenderFunction<HTMLSpanElement, TooltipProps> = (
  props,
  ref,
) => {
  const {
    content,
    children,
    side = "top",
    ariaLabel,
    className,
    ...rest
  } = props;
  const { isOpen, open, close } = useDisclosure();
  const contentId = useId();

  const sideClasses =
    side === "top"
      ? "bottom-full left-1/2 -translate-x-1/2 mb-1"
      : "top-full left-1/2 -translate-x-1/2 mt-1";

  return (
    <span ref={ref} className={cn("relative inline-flex", className)} {...rest}>
      <span
        tabIndex={0}
        aria-label={ariaLabel}
        aria-describedby={isOpen ? contentId : undefined}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
        onKeyDown={(e) => {
          if (e.key === "Escape") close();
        }}
        className="inline-flex cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-sm"
      >
        {children}
      </span>
      {isOpen && (
        <span
          role="tooltip"
          id={contentId}
          className={cn(
            "absolute z-50 w-max max-w-xs rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow",
            sideClasses,
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
};

export const Tooltip = forwardRef(TooltipRender);
Tooltip.displayName = "Tooltip";
