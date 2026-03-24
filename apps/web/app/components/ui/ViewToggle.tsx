"use client";

import * as React from "react";
import { Eye, Code } from "lucide-react";
import { cn } from "@/lib/utils";

interface ViewToggleProps extends Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "onChange"
> {
  view: "visual" | "code";
  onChange: (view: "visual" | "code") => void;
}

const ViewToggle = React.forwardRef<HTMLDivElement, ViewToggleProps>(
  ({ className, view, onChange, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn("flex items-center gap-2", className)}
        {...props}
      >
        <label className="relative inline-flex items-center cursor-pointer select-none">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={view === "code"}
            onChange={() => onChange(view === "visual" ? "code" : "visual")}
            aria-label="Toggle between visual and code view"
          />

          {/* Track */}
          <div className="w-16 h-8 bg-muted rounded-full border-2 border-transparent peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 transition-colors peer-checked:bg-primary/10" />

          {/* Thumb */}
          <div className="absolute left-1 top-1 w-6 h-6 bg-background rounded-full shadow-sm transition-all flex items-center justify-center peer-checked:translate-x-8">
            {view === "visual" ? (
              <Eye className="h-3.5 w-3.5 text-primary" />
            ) : (
              <Code className="h-3.5 w-3.5 text-primary" />
            )}
          </div>

          {/* Background Icons (Ghost) */}
          <div className="absolute inset-0 flex items-center justify-between px-2.5 pointer-events-none">
            <Eye
              className={cn(
                "h-3.5 w-3.5 transition-opacity",
                view === "visual" ? "opacity-0" : "opacity-20",
              )}
            />
            <Code
              className={cn(
                "h-3.5 w-3.5 transition-opacity",
                view === "code" ? "opacity-0" : "opacity-20",
              )}
            />
          </div>
        </label>
      </div>
    );
  },
);

ViewToggle.displayName = "ViewToggle";

export { ViewToggle };
