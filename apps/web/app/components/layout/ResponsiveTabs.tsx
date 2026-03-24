"use client";

import { useState } from "react";
import { FileText, Layout, Bot } from "lucide-react";

export interface TabPanel {
  id: string;
  title: string;
  icon?: "wizard" | "preview" | "ai";
  content: React.ReactNode;
}

interface ResponsiveTabsProps {
  panels: TabPanel[];
  defaultTab?: string;
}

const ICONS = {
  wizard: FileText,
  preview: Layout,
  ai: Bot,
};

export function ResponsiveTabs({ panels, defaultTab }: ResponsiveTabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab || panels[0]?.id || "");

  const activePanel = panels.find((p) => p.id === activeTab);

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Tab Bar */}
      <div className="flex shrink-0 border-b border-border">
        {panels.map((panel) => {
          const IconComponent = panel.icon ? ICONS[panel.icon] : null;
          const isActive = activeTab === panel.id;

          return (
            <button
              key={panel.id}
              type="button"
              onClick={() => setActiveTab(panel.id)}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
                isActive
                  ? "text-primary border-b-2 border-primary bg-primary/5"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              {IconComponent && <IconComponent className="h-4 w-4" />}
              <span className="hidden sm:inline">{panel.title}</span>
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activePanel?.content}
      </div>
    </div>
  );
}
