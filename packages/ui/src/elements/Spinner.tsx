import type { HTMLAttributes, ForwardRefRenderFunction } from "react";
import { forwardRef } from "react";
import type { NoSemanticState } from "../types/forbidden-brand.js";

export interface SpinnerProps extends NoSemanticState<
  HTMLAttributes<SVGSVGElement>
> {
  size?: number;
}

const SpinnerComponent: ForwardRefRenderFunction<
  SVGSVGElement,
  SpinnerProps
> = ({ size = 24, className, ...props }, ref) => {
  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`animate-spin ${className ?? ""}`}
      {...props}
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
};

export const Spinner = forwardRef(SpinnerComponent);
Spinner.displayName = "Spinner";
