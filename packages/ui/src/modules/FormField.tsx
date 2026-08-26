import type { ReactElement } from "react";
import { Children, cloneElement } from "react";
import { Label } from "../elements/Label.js";
import { cn } from "../lib/utils.js";
import type { NoSemanticState } from "../types/forbidden-brand.js";

/**
 * Composition of `Label` + a form control + hint/validation slots.
 *
 * CONSTRAINT: `children` must be a SINGLE React element (the control). The
 * component wires `aria-describedby` onto that child via `cloneElement`, which
 * only works for exactly one element — fragments, arrays or text children are
 * a usage error (`Children.only` throws).
 *
 * When `validationMessage` is set it renders with `role="alert"` and the child
 * is described by it; a `hint` is described the same way (both ids are joined
 * when both are present, preserving any `aria-describedby` the child already
 * carries).
 */
export type FormFieldProps = NoSemanticState<{
  label: string;
  htmlFor: string;
  children: ReactElement<Record<string, unknown>>;
  validationMessage?: string;
  hint?: string;
  className?: string;
}>;

export function FormField({
  label,
  htmlFor,
  children,
  validationMessage,
  hint,
  className,
}: FormFieldProps) {
  const child = Children.only(children);
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const validationId = validationMessage ? `${htmlFor}-validation` : undefined;
  const existingDescribedBy =
    typeof child.props["aria-describedby"] === "string"
      ? child.props["aria-describedby"]
      : undefined;
  const describedBy =
    [existingDescribedBy, hintId, validationId].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {cloneElement(child, { "aria-describedby": describedBy })}
      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {validationMessage ? (
        <p id={validationId} role="alert" className="text-sm text-destructive">
          {validationMessage}
        </p>
      ) : null}
    </div>
  );
}
