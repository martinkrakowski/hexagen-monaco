import { cva } from "class-variance-authority";
import type { ButtonHTMLAttributes, ForwardRefRenderFunction } from "react";
import { forwardRef } from "react";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-white hover:bg-primary-hover",
        destructive: "bg-error text-white hover:bg-error/90",
        outline: "border border-border-default hover:bg-bg-tertiary",
        secondary: "bg-bg-secondary text-text-primary hover:bg-bg-tertiary",
        ghost: "hover:bg-bg-tertiary",
        link: "underline-offset-4 hover:underline text-primary",
      },
      size: {
        default: "h-10 py-2 px-4",
        sm: "h-9 px-3",
        lg: "h-11 px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export type ButtonVariant =
  | "default"
  | "destructive"
  | "outline"
  | "secondary"
  | "ghost"
  | "link";
export type ButtonSize = "default" | "sm" | "lg" | "icon";

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const ButtonElement: ForwardRefRenderFunction<
  HTMLButtonElement,
  ButtonProps
> = ({ className, variant, size, type = "button", ...props }, ref) => {
  return (
    <button
      type={type}
      className={buttonVariants({ variant, size, className })}
      ref={ref}
      {...props}
    />
  );
};

export const Button = forwardRef(ButtonElement);
Button.displayName = "Button";

export { buttonVariants };