import type { InputHTMLAttributes, ForwardRefRenderFunction } from "react";
import { forwardRef } from "react";
import type { NoSemanticState } from "../types/forbidden-brand.js";

export interface InputProps extends NoSemanticState<
  InputHTMLAttributes<HTMLInputElement>
> {
  type?: string;
}

const InputComponent: ForwardRefRenderFunction<HTMLInputElement, InputProps> = (
  { className, type = "text", ...props },
  ref,
) => {
  return (
    <input
      type={type}
      className={[
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
        "placeholder:text-muted-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      ref={ref}
      {...props}
    />
  );
};

export const Input = forwardRef(InputComponent);
Input.displayName = "Input";
