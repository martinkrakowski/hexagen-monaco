/**
 * Tiny string helpers. Hand-written library code — not a Hexagen app.
 * This tree is the 6.7(a)-FIX external-repo fixture (HEX-025 prereq).
 */
export function titleCase(value) {
  return String(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
