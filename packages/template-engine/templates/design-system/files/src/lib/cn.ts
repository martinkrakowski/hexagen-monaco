import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Compose Tailwind class names with conflict resolution.
 *
 * `clsx` flattens conditional/array/object class inputs; `twMerge` then drops
 * earlier classes that a later one overrides (e.g. `px-2` then `px-4` → `px-4`),
 * so variant defaults can be overridden by a caller's `className`.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
