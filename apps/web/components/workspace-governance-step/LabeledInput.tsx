"use client";

import { useId } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";

interface LabeledInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "onChange"
> {
  label: ReactNode;
  /** Input value; callback receives the raw string. */
  value: string;
  onChange: (value: string) => void;
  /**
   * When true uses the more compact label styling for nested
   * fieldsets (e.g. Naming Conventions subsection). When false,
   * uses the uppercase-bold style used for top-level fields.
   */
  compact?: boolean;
}

/**
 * Labeled text input used for all workspace governance fields.
 * Replaces five inline `<div><label>...<input /></div>` blocks
 * with a single primitive. Styling parity with the original
 * inline markup preserved exactly.
 */
export function LabeledInput({
  label,
  value,
  onChange,
  compact = false,
  className,
  // `id` must be destructured here, NOT left in `...rest`: the rest spread
  // lands after the explicit `id={id}` on the input, so a caller-supplied id
  // riding in `rest` would silently override it while `htmlFor` kept pointing
  // at the generated id, breaking the label association.
  id: idProp,
  ...rest
}: LabeledInputProps) {
  // Unconditional hook call — don't fold into `idProp ?? useId()` (the
  // short-circuit would make the hook conditional).
  const generatedId = useId();
  const id = idProp ?? generatedId;
  const labelClasses = compact
    ? "text-xs font-medium text-muted-foreground"
    : "text-xs font-bold uppercase tracking-wider text-muted-foreground";
  const inputPadding = compact ? "px-3 py-2" : "px-4 py-2";

  return (
    <div className="space-y-2">
      <label htmlFor={id} className={labelClasses}>
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={
          className ??
          `w-full ${inputPadding} bg-background border border-input rounded-md`
        }
        {...rest}
      />
    </div>
  );
}
