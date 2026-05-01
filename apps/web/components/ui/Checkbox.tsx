"use client";

import * as React from "react";
import { cn } from "../../utils/cn";

export interface CheckboxProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export function Checkbox({
  className,
  checked,
  onCheckedChange,
  ...props
}: CheckboxProps) {
  return (
    <span className="relative flex h-5 w-5 items-center justify-center">
      <input
        type="checkbox"
        className="peer absolute inset-0 h-5 w-5 cursor-pointer opacity-0"
        checked={checked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        {...props}
      />
      <span
        className={cn(
          "flex h-5 w-5 items-center justify-center rounded border border-primary",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
          "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
          "transition-colors",
          className
        )}
      >
        {checked && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5 text-primary"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
    </span>
  );
}