import type { LabelHTMLAttributes, ForwardRefRenderFunction } from "react";
import { forwardRef } from "react";

export interface LabelProps
  extends LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

const LabelComponent: ForwardRefRenderFunction<
  HTMLLabelElement,
  LabelProps
> = ({ className, ...props }, ref) => {
  return (
    <label
      ref={ref}
      className={[
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
};

export const Label = forwardRef(LabelComponent);
Label.displayName = "Label";