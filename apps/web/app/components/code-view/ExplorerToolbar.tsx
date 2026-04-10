"use client";

import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// ─── Context ────────────────────────────────────────────────────────────────

interface ExplorerToolbarContextValue {
  isNetworkActive: boolean;
}

const ExplorerToolbarContext =
  createContext<ExplorerToolbarContextValue | null>(null);

function useToolbarContext(): ExplorerToolbarContextValue {
  const ctx = useContext(ExplorerToolbarContext);
  if (!ctx)
    throw new Error(
      "ExplorerToolbar subcomponents must be used inside <ExplorerToolbar.Root>",
    );
  return ctx;
}

// ─── Root ────────────────────────────────────────────────────────────────────

interface RootProps {
  isNetworkActive: boolean;
  children: ReactNode;
  className?: string;
}

function Root({ isNetworkActive, children, className }: RootProps) {
  return (
    <ExplorerToolbarContext.Provider value={{ isNetworkActive }}>
      <div
        className={cn(
          "text-xs font-semibold text-muted-foreground uppercase tracking-wider p-4 border-b border-border shrink-0 flex items-center justify-between",
          className,
        )}
      >
        {children}
      </div>
    </ExplorerToolbarContext.Provider>
  );
}

// ─── Label ───────────────────────────────────────────────────────────────────

function Label({ children }: { children: ReactNode }) {
  return <span>{children}</span>;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-3">{children}</div>;
}

// ─── Button ──────────────────────────────────────────────────────────────────

interface ActionButtonProps {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
  className?: string;
}

function ActionButton({
  onClick,
  disabled = false,
  title,
  children,
  className,
}: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "transition-colors disabled:opacity-50 hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

// ─── StaleIndicator ──────────────────────────────────────────────────────────

interface StaleIndicatorProps {
  isStale: boolean;
  onClick: () => void;
  children: ReactNode;
}

function StaleIndicator({ isStale, onClick, children }: StaleIndicatorProps) {
  const { isNetworkActive } = useToolbarContext();
  return (
    <div className="relative flex items-center">
      <button
        onClick={onClick}
        disabled={isNetworkActive}
        title={
          isStale ? "Pending changes. Click to regenerate." : "Force Regenerate"
        }
        className={cn(
          "transition-colors disabled:opacity-50",
          isStale
            ? "text-blue-400 hover:text-blue-300"
            : "hover:text-foreground",
        )}
      >
        {children}
      </button>
      {isStale && !isNetworkActive && (
        <span className="absolute -top-1 -right-1 flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
        </span>
      )}
    </div>
  );
}

// ─── Export ──────────────────────────────────────────────────────────────────

export const ExplorerToolbar = {
  Root,
  Label,
  Actions,
  ActionButton,
  StaleIndicator,
};
