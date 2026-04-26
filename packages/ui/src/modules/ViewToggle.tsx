import type { HTMLAttributes, Ref } from "react";
import { Eye, Code } from "lucide-react";
import { cn } from "../lib/utils.js";

export interface ViewToggleProps<T extends string = string> extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange"
> {
  view: T;
  options: readonly [T, T];
  onChange: (view: T) => void;
  ariaLabel?: string;
  ref?: Ref<HTMLDivElement>;
}

export function ViewToggle<T extends string = string>({
  className,
  view,
  options,
  onChange,
  ariaLabel = "Toggle view",
  ref,
  ...props
}: ViewToggleProps<T>) {
  const [optionA, optionB] = options;
  const handleChange = () => {
    onChange(view === optionA ? optionB : optionA);
  };

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
          checked={view === optionB}
          onChange={handleChange}
          aria-label={ariaLabel}
        />

        <div className="w-16 h-8 bg-muted rounded-full border-2 border-transparent peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 transition-colors peer-checked:bg-primary/10" />

        <div className="absolute left-1 top-1 w-6 h-6 bg-background rounded-full shadow-sm transition-transform flex items-center justify-center peer-checked:translate-x-8">
          {view === optionA ? (
            <Eye className="h-3.5 w-3.5 text-primary" />
          ) : (
            <Code className="h-3.5 w-3.5 text-primary" />
          )}
        </div>

        <div className="absolute inset-0 flex items-center justify-between px-2.5 pointer-events-none">
          <Eye
            className={cn(
              "h-3.5 w-3.5 transition-opacity",
              view === optionA ? "opacity-0" : "opacity-20",
            )}
          />
          <Code
            className={cn(
              "h-3.5 w-3.5 transition-opacity",
              view === optionB ? "opacity-0" : "opacity-20",
            )}
          />
        </div>
      </label>
    </div>
  );
}
