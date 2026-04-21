import type { HTMLAttributes, ForwardRefRenderFunction } from "react";
import { forwardRef } from "react";
import type { NoSemanticState } from "../types/forbidden-brand.js";

const CardComponent: ForwardRefRenderFunction<
  HTMLDivElement,
  NoSemanticState<HTMLAttributes<HTMLDivElement>>
> = ({ className, ...props }, ref) => {
  return (
    <div
      ref={ref}
      className={[
        "rounded-md border border-border-default bg-bg-elevated shadow-sm",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
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
      className={["flex flex-col space-y-1.5 p-4", className]
        .filter(Boolean)
        .join(" ")}
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
      className={[
        "text-base font-semibold leading-none tracking-tight",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
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
  return (
    <div
      ref={ref}
      className={["p-4 pt-0", className].filter(Boolean).join(" ")}
      {...props}
    />
  );
};

export const CardContent = forwardRef(CardContentComponent);
CardContent.displayName = "CardContent";
