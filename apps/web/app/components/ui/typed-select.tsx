import * as React from "react";
import { cn } from "@/lib/utils";

export interface TypedSelectProps<
  T extends string,
> extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: Array<{ value: T; label: string }>;
  placeholder?: string;
}

export const TypedSelect = React.forwardRef(function TypedSelect<
  T extends string,
>(
  { className, options, placeholder, ...props }: TypedSelectProps<T>,
  ref: React.ForwardedRef<HTMLSelectElement>,
) {
  return (
    <select
      ref={ref}
      className={cn(
        "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
});

TypedSelect.displayName = "TypedSelect";
