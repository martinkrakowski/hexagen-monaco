export type ErrorCategory =
  | "NETWORK"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "PARSING"
  | "UNKNOWN";

export const ERROR_MESSAGES: Record<ErrorCategory, string> = {
  NETWORK: "Unable to connect to the server. Please check your internet connection and try again.",
  TIMEOUT: "The request took too long to complete. Please try again or use a simpler description.",
  RATE_LIMIT: "Too many requests. Please wait a moment before trying again.",
  PARSING: "We received an invalid response from the server. Please try a different description.",
  UNKNOWN: "An unexpected error occurred. Please try again.",
};

export function classifyError(error: unknown, status?: number): ErrorCategory {
  if (status === 429) return "RATE_LIMIT";
  if (status === 504 || status === 408) return "TIMEOUT";

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("network") || msg.includes("failed to fetch")) return "NETWORK";
    if (msg.includes("timeout") || msg.includes("aborted")) return "TIMEOUT";
    if (msg.includes("parse") || msg.includes("json")) return "PARSING";
  }

  return "UNKNOWN";
}
