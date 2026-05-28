"use client";

export interface TandemRetryButtonProps {
  canRetry: boolean;
  onRetry: () => void;
  isLoading: boolean;
}

/**
 * TandemRetryButton
 *
 * Renders a "Retry Cloud Refinement" button below the last assistant message
 * when `canRetry` is true. Shows a spinner while retrying.
 * Renders nothing when `canRetry` is false.
 */
export function TandemRetryButton({
  canRetry,
  onRetry,
  isLoading,
}: TandemRetryButtonProps) {
  if (!canRetry) {
    return null;
  }

  return (
    <div className="flex justify-start ml-0 mt-1">
      <button
        type="button"
        onClick={onRetry}
        disabled={isLoading}
        aria-label={
          isLoading ? "Retrying cloud refinement…" : "Retry cloud refinement"
        }
        className={[
          "inline-flex items-center gap-2 h-8 px-3 rounded-md text-xs font-medium",
          "border border-blue-500 text-blue-700 bg-transparent",
          "hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20",
          "disabled:opacity-60 disabled:cursor-not-allowed",
          "transition-colors",
        ].join(" ")}
      >
        {isLoading ? (
          <>
            <span
              aria-hidden="true"
              className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"
            />
            Retrying…
          </>
        ) : (
          <>
            {/* Circular arrows icon rendered as unicode */}
            <span aria-hidden="true" className="text-sm leading-none">
              ↺
            </span>
            Retry Cloud Refinement
          </>
        )}
      </button>
    </div>
  );
}
