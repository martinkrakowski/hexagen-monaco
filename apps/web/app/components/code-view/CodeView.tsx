"use client";

import React from "react";
import { FileCode } from "lucide-react";

export const CodeView: React.FC = () => {
  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Sidebar Placeholder */}
      <div className="w-64 border-r bg-muted/30 p-4 hidden md:block">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          Explorer
        </div>
        <div className="space-y-2 opacity-50">
          <div className="h-4 w-3/4 bg-muted rounded animate-pulse" />
          <div className="h-4 w-1/2 bg-muted rounded animate-pulse" />
          <div className="h-4 w-2/3 bg-muted rounded animate-pulse" />
        </div>
      </div>

      {/* Main Content Placeholder */}
      <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
        <div className="bg-primary/5 p-4 rounded-full mb-4">
          <FileCode className="h-8 w-8 text-primary opacity-40" />
        </div>
        <h3 className="text-lg font-medium">Code View Coming Soon</h3>
        <p className="text-sm text-muted-foreground max-w-xs mt-2">
          This panel will soon feature a full file browser and Monaco editor for
          your generated hexagonal project.
        </p>
      </div>
    </div>
  );
};
