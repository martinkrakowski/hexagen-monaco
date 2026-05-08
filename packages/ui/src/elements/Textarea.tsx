import type { TextareaHTMLAttributes, ForwardRefRenderFunction } from "react";
import { forwardRef } from "react";
import type { NoSemanticState } from "../types/forbidden-brand.js";

export interface TextareaProps extends NoSemanticState<
  TextareaHTMLAttributes<HTMLTextAreaElement>
> {
  rows?: number;
}

const TextareaComponent: ForwardRefRenderFunction<
  HTMLTextAreaElement,
  TextareaProps
> = ({ className, ...props }, ref) => {
  return (
    <textarea
      className={[
        "flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
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

export const Textarea = forwardRef(TextareaComponent);
Textarea.displayName = "Textarea";
