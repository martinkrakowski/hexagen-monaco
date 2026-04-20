import { cva } from "class-variance-authority";
import type { HTMLAttributes, ForwardRefRenderFunction } from "react";
import { forwardRef } from "react";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-border-focus",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-white",
        secondary: "border-transparent bg-bg-secondary text-text-secondary",
        destructive: "border-transparent bg-error text-white",
        outline: "border-border-default text-text-primary",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline";

export interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant;
}

const BadgeElement: ForwardRefRenderFunction<
  HTMLDivElement,
  BadgeProps
> = ({ className, variant, ...props }, ref) => {
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