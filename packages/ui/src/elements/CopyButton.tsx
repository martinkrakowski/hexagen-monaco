"use client";

import { useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "./Button.js";
import type { ButtonProps } from "./Button.js";

export interface CopyButtonProps extends Omit<
  ButtonProps,
  "onClick" | "children"
> {
  text: string;
  label?: string;
  resetDelay?: number;
}

export function CopyButton({
  text,
  label,
  resetDelay = 2000,
  variant = "ghost",
  size,
  className,
  ...props
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const defaultSize = label ? "sm" : "icon";

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), resetDelay);
  }, [text, resetDelay]);

  return (
    <Button
      variant={variant}
      size={size ?? defaultSize}
      className={className}
      onClick={handleCopy}
      {...props}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {label && <span>{copied ? "Copied!" : label}</span>}
    </Button>
  );
}
