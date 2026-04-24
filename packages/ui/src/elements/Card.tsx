import type { HTMLAttributes, ForwardRefRenderFunction } from "react";
import { forwardRef } from "react";
import type { NoSemanticState } from "../types/forbidden-brand.js";
import { cn } from "../lib/utils.js";

const CardComponent: ForwardRefRenderFunction<
  HTMLDivElement,
  NoSemanticState<HTMLAttributes<HTMLDivElement>>
> = ({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-md border border-border bg-card shadow-sm",
        className,
      )}
      {...props}
    />
  );
};

export const Card = forwardRef(CardComponent);
Card.displayName = "Card";

const CardHeaderComponent: ForwardRefRenderFunction<
  HTMLDivElement,
  NoSemanticState<HTMLAttributes<HTMLDivElement>>
> = ({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={cn("flex flex-col space-y-1.5 p-4", className)}
      {...props}
    />
  );
};

export const CardHeader = forwardRef(CardHeaderComponent);
CardHeader.displayName = "CardHeader";

export type CardTitleAs = "h1" | "h2" | "h3" | "h4";

export interface CardTitleProps extends NoSemanticState<
  HTMLAttributes<HTMLHeadingElement>
> {
  as?: CardTitleAs;
}

const CardTitleComponent: ForwardRefRenderFunction<
  HTMLHeadingElement,
  CardTitleProps
> = ({ className, as: Tag = "h3", ...props }, ref) => {
  const TagName = Tag;
  return (
    <TagName
      ref={ref}
      className={cn(
        "text-base font-semibold leading-none tracking-tight",
        className,
      )}
      {...props}
    />
  );
};

export const CardTitle = forwardRef(CardTitleComponent);
CardTitle.displayName = "CardTitle";

const CardContentComponent: ForwardRefRenderFunction<
  HTMLDivElement,
  NoSemanticState<HTMLAttributes<HTMLDivElement>>
> = ({ className, ...props }, ref) => {
  return <div ref={ref} className={cn("pt-0", className)} {...props} />;
};

export const CardContent = forwardRef(CardContentComponent);
CardContent.displayName = "CardContent";
