/**
 * Human-readable timestamp formatter for saved-project cards.
 * Format: "Mar 14, 2024, 9:30 AM".
 */
export function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
