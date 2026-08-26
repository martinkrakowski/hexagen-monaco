import type { LabelHTMLAttributes, ForwardRefRenderFunction } from "react";
import { forwardRef } from "react";
import { cn } from "../lib/utils.js";
import type { NoSemanticState } from "../types/forbidden-brand.js";

export interface LabelProps extends NoSemanticState<
  LabelHTMLAttributes<HTMLLabelElement>
> {
  /**
   * Renders a decorative asterisk after the label text. The asterisk is
   * `aria-hidden` and the prop is NOT spread onto the DOM `<label>` —
   * `required` is not a valid `<label>` attribute (it belongs on the control).
   */
  required?: boolean;
}

const LabelComponent: ForwardRefRenderFunction<HTMLLabelElement, LabelProps> = (
  { className, required, children, ...props },
  ref,
) => {
  return (
    <label
      ref={ref}
      className={cn(
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...props}
    >
      {children}
      {required ? (
        <span aria-hidden="true" className="ms-1 text-destructive">
          *
        </span>
      ) : null}
    </label>
  );
};

export const Label = forwardRef(LabelComponent);
Label.displayName = "Label";
