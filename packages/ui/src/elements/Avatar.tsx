"use client";

import { cva } from "class-variance-authority";
import { useState } from "react";
import { cn } from "../lib/utils.js";
import type { NoSemanticState } from "../types/forbidden-brand.js";

/**
 * Image avatar with an initials fallback.
 *
 * When `src` is missing or the image fails to load, renders up-to-2-letter
 * initials derived from `name` (first letter of the first and last word). The
 * image carries `alt={name}`; in fallback mode the initials block is
 * `aria-hidden` and the wrapper carries the accessible name via `role="img"`
 * + `aria-label`.
 */
const avatarVariants = cva(
  "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-medium text-muted-foreground select-none",
  {
    variants: {
      size: {
        sm: "h-8 w-8 text-xs",
        md: "h-10 w-10 text-sm",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

export type AvatarSize = "sm" | "md";

export type AvatarProps = NoSemanticState<{
  name: string;
  src?: string;
  size?: AvatarSize;
  className?: string;
}>;

function initialsFromName(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const first = words[0]?.charAt(0) ?? "";
  const last =
    words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase();
}

export function Avatar({ name, src, size, className }: AvatarProps) {
  // Failure is remembered PER SOURCE: a new src gets a fresh attempt, so an
  // avatar reused across user changes (or a refreshed image URL) is not
  // permanently stuck on initials after one bad load.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src) && failedSrc !== src;

  if (showImage) {
    return (
      <span className={cn(avatarVariants({ size }), className)}>
        <img
          src={src}
          alt={name}
          className="h-full w-full object-cover"
          onError={() => setFailedSrc(src ?? null)}
        />
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={name}
      className={cn(avatarVariants({ size }), className)}
    >
      <span aria-hidden="true">{initialsFromName(name)}</span>
    </span>
  );
}

export { avatarVariants };
