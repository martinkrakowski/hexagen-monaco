import { cva } from "class-variance-authority";
import type { HTMLAttributes, ForwardRefRenderFunction } from "react";
import { forwardRef } from "react";
import type { NoSemanticState } from "../types/forbidden-brand.js";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-border text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

export interface BadgeProps extends NoSemanticState<
  HTMLAttributes<HTMLDivElement>
> {
  variant?: BadgeVariant;
}

const BadgeElement: ForwardRefRenderFunction<HTMLDivElement, BadgeProps> = (
  { className, variant, ...props },
  ref,
) => {
  return (
    <div
      ref={ref}
      className={[badgeVariants({ variant }), className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
};

export const Badge = forwardRef(BadgeElement);
Badge.displayName = "Badge";

export { badgeVariants };
