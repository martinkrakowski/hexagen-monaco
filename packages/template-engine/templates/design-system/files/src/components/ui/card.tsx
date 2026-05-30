import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export type CardProps = HTMLAttributes<HTMLDivElement>;

/** Surface container — token-driven background, border, radius, and shadow. */
export function Card(props: CardProps): ReactNode {
  const { className, children, ...rest } = props;
  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-surface text-text-primary shadow-sm",
        className,
      )}
      {...rest}
    >
      {children ?? null}
    </div>
  );
}

/** Padded header region for a Card. */
export function CardHeader(props: CardProps): ReactNode {
  const { className, children, ...rest } = props;
  return (
    <div className={cn("flex flex-col gap-1 p-6", className)} {...rest}>
      {children ?? null}
    </div>
  );
}

/** Padded body region for a Card. */
export function CardContent(props: CardProps): ReactNode {
  const { className, children, ...rest } = props;
  return (
    <div className={cn("p-6 pt-0", className)} {...rest}>
      {children ?? null}
    </div>
  );
}
