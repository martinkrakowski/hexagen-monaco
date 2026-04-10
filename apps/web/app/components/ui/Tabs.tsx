"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// ─── Context ────────────────────────────────────────────────────────────────

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

// ─── Root ────────────────────────────────────────────────────────────────────

interface RootProps {
  defaultTab: string;
  children: ReactNode;
  className?: string;
}

function Root({ defaultTab, children, className }: RootProps) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className={cn("flex flex-col h-full", className)}>{children}</div>
    </TabsContext.Provider>
  );
}

// ─── List ────────────────────────────────────────────────────────────────────

function List({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex border-b border-border shrink-0", className)}>
      {children}
    </div>
  );
}

// ─── Trigger ─────────────────────────────────────────────────────────────────

interface TriggerProps {
  value: string;
  children: ReactNode;
  className?: string;
}

function Trigger({ value, children, className }: TriggerProps) {
  const { activeTab, setActiveTab } = useTabsContext();
  const isActive = activeTab === value;
  return (
    <button
      onClick={() => setActiveTab(value)}
      className={cn(
        "flex-1 flex items-center justify-center gap-2 px-3 py-3 text-sm font-medium transition-colors",
        isActive
          ? "text-primary border-b-2 border-primary bg-muted/50"
          : "text-muted-foreground hover:text-foreground",
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
    <div className={cn("flex-1 overflow-hidden", className)}>{children}</div>
  );
}

// ─── Export ──────────────────────────────────────────────────────────────────

export const Tabs = { Root, List, Trigger, Content };
