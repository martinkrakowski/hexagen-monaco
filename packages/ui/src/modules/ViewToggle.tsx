import type {
  HTMLAttributes,
  ForwardRefRenderFunction,
  ReactNode,
} from "react";
import { forwardRef } from "react";
import { Eye, Code } from "lucide-react";
import { cn } from "../lib/utils.js";
import type { NoSemanticState } from "../types/forbidden-brand.js";

export interface ViewToggleProps extends NoSemanticState<
  Omit<HTMLAttributes<HTMLDivElement>, "onChange">
> {
  view: string;
  options: readonly [string, string];
  onChange: (view: string) => void;
  ariaLabel?: string;
  iconA?: ReactNode;
  iconB?: ReactNode;
}

const ViewToggleRender: ForwardRefRenderFunction<
  HTMLDivElement,
  ViewToggleProps
> = (props: ViewToggleProps, ref: React.Ref<HTMLDivElement>) => {
  const {
    className,
    view,
    options,
    onChange,
    ariaLabel = "Toggle view",
    iconA = <Eye className="h-4 w-4 text-primary" />,
    iconB = <Code className="h-4 w-4 text-primary" />,
    ...rest
  } = props;
  const [optionA, optionB] = options;
  const handleChange = () => {
    onChange(view === optionA ? optionB : optionA);
  };

  return (
    <div
      ref={ref}
      className={cn("flex items-center gap-2", className)}
      {...rest}
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
          {view === optionA ? iconA : iconB}
        </div>

        <div className="absolute inset-0 flex items-center justify-between px-2 pointer-events-none">
          <div
            className={cn(
              "transition-opacity",
              view === optionA ? "opacity-0" : "opacity-20",
            )}
          >
            {iconA}
          </div>
          <div
            className={cn(
              "transition-opacity",
              view === optionB ? "opacity-0" : "opacity-20",
            )}
          >
            {iconB}
          </div>
        </div>
      </label>
    </div>
  );
};

export const ViewToggle = forwardRef(ViewToggleRender);
ViewToggle.displayName = "ViewToggle";
