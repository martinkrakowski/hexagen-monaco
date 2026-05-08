"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { cn } from "../lib/utils.js";

// ─── Context ─────────────────────────────────────────────────────────────────

interface TabsContextValue {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(): TabsContextValue {
  const ctx = useContext(TabsContext);
  if (!ctx)
    throw new Error("Tabs subcomponents must be used inside <Tabs.Root>");
  return ctx;
}

// ─── Root ─────────────────────────────────────────────────────────────────────

interface RootProps {
  defaultTab?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}

function Root({
  defaultTab,
  value,
  onValueChange,
  children,
  className,
}: RootProps) {
  const [internalTab, setInternalTab] = useState(defaultTab ?? "");
  const activeTab = value ?? internalTab;
  const handleSetActiveTab = (tab: string) => {
    if (onValueChange) {
      onValueChange(tab);
    } else {
      setInternalTab(tab);
    }
  };
  return (
    <TabsContext.Provider
      value={{ activeTab, setActiveTab: handleSetActiveTab }}
    >
      <div className={cn("flex flex-col h-full", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

// ─── List ─────────────────────────────────────────────────────────────────────

function List({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "flex border-b border-border bg-card/50 shrink-0 px-4 py-3 h-12",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ─── Trigger ──────────────────────────────────────────────────────────────────

interface TriggerProps {
  value: string;
  children: ReactNode;
  className?: string;
}

function Trigger({ value, children, className }: TriggerProps) {
  const { activeTab, setActiveTab } = useTabsContext();
  const isActive = activeTab === value;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const list = e.currentTarget.closest('[role="tablist"]');
    if (!list) return;
    const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'));
    const idx = tabs.indexOf(e.currentTarget);

    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      const next = tabs[(idx + 1) % tabs.length];
      next?.click();
      next?.focus();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      const prev = tabs[(idx - 1 + tabs.length) % tabs.length];
      prev?.click();
      prev?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      tabs[0]?.click();
      tabs[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      tabs[tabs.length - 1]?.click();
      tabs[tabs.length - 1]?.focus();
    }
  };

  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      aria-controls={`tabpanel-${value}`}
      id={`tab-${value}`}
      tabIndex={isActive ? 0 : -1}
      onClick={() => setActiveTab(value)}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex-1 flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        isActive
          ? "text-primary border-b-2 border-primary bg-card"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
        className,
      )}
    >
      {children}
    </button>
  );
}

// ─── Content ─────────────────────────────────────────────────────────────────

interface ContentProps {
  value: string;
  children: ReactNode;
  className?: string;
}

function Content({ value, children, className }: ContentProps) {
  const { activeTab } = useTabsContext();
  if (activeTab !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`tabpanel-${value}`}
      aria-labelledby={`tab-${value}`}
      tabIndex={0}
      className={cn(
        "flex-1 overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export const Tabs = { Root, List, Trigger, Content };
