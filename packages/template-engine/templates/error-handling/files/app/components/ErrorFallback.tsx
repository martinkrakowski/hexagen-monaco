"use client";

import type { ReactNode } from "react";

interface ErrorFallbackProps {
  error: Error;
  reset: () => void;
}

/**
 * Default fallback UI for ErrorBoundary. The classes use the design-system
 * tokens when that template is installed (surface / border / brand); they
 * degrade to plain colours otherwise. Keep user-facing copy generic — never
 * render a stack trace in production.
 */
export function ErrorFallback({ error, reset }: ErrorFallbackProps): ReactNode {
  return (
    <div
      role="alert"
      className="mx-auto my-12 max-w-md rounded-lg border border-border bg-surface p-6 text-text-primary"
    >
      <h2 className="text-lg font-semibold">Something went wrong</h2>
      <p className="mt-2 text-sm text-text-secondary">
        {error?.message ?? "An unexpected error occurred."}
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-4 inline-flex h-10 items-center rounded-md bg-brand-primary px-4 text-sm font-medium text-white hover:bg-brand-primary-hover"
      >
        Try again
      </button>
    </div>
  );
}
