"use client";

import type { ForwardRefRenderFunction, InputHTMLAttributes } from "react";
import { forwardRef } from "react";
import type { NoSemanticState } from "../types/forbidden-brand.js";

export interface CheckboxProps extends NoSemanticState<
  InputHTMLAttributes<HTMLInputElement>
> {
  onCheckedChange?: (checked: boolean) => void;
}

const CheckboxElement: ForwardRefRenderFunction<
  HTMLInputElement,
  CheckboxProps
> = ({ className, checked, onCheckedChange, ...props }, ref) => {
  return (
    <span className="relative flex h-5 w-5 items-center justify-center">
      <input
        type="checkbox"
        className="peer absolute inset-0 h-5 w-5 cursor-pointer opacity-0"
        checked={checked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        ref={ref}
        {...props}
      />
      <span
        className={[
          "flex h-5 w-5 items-center justify-center rounded border border-primary",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
          "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
          "transition-colors",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
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
};

export const Checkbox = forwardRef(CheckboxElement);
Checkbox.displayName = "Checkbox";
