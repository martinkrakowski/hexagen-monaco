import type { HTMLAttributes, ForwardRefRenderFunction } from "react";
import { forwardRef } from "react";
import { Icon } from "../elements/Icon";

export type ViewMode = "visual" | "code";

export interface ViewToggleProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "onChange"
> {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
}

const ViewToggleComponent: ForwardRefRenderFunction<
  HTMLDivElement,
  ViewToggleProps
> = ({ className, view, onChange, ...props }, ref) => {
  const handleChange = () => {
    onChange(view === "visual" ? "code" : "visual");
  };

  return (
    <div
      ref={ref}
      className={["flex items-center gap-2", className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      <label className="relative inline-flex items-center cursor-pointer select-none">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={view === "code"}
          onChange={handleChange}
          aria-label="Toggle between visual and code view"
        />

        <div className="w-16 h-8 bg-bg-tertiary rounded-full border-2 border-transparent peer-focus-visible:ring-2 peer-focus-visible:ring-border-focus peer-focus-visible:ring-offset-2 transition-colors peer-checked:bg-primary/10" />

        <div className="absolute left-1 top-1 w-6 h-6 bg-bg-elevated rounded-full shadow-sm transition-transform flex items-center justify-center peer-checked:translate-x-8">
          <Icon
            name={view === "visual" ? "eye" : "chevron-right"}
            size={14}
            className="text-primary"
          />
        </div>

        <div className="absolute inset-0 flex items-center justify-between px-2.5 pointer-events-none">
          <Icon
            name="eye"
            size={14}
            className={[
              "transition-opacity",
              view === "visual" ? "opacity-0" : "opacity-20",
            ]
              .filter(Boolean)
              .join(" ")}
          />
          <Icon
            name="chevron-right"
            size={14}
            className={[
              "transition-opacity",
              view === "code" ? "opacity-0" : "opacity-20",
            ]
              .filter(Boolean)
              .join(" ")}
          />
        </div>
      </label>
    </div>
  );
};

export const ViewToggle = forwardRef(ViewToggleComponent);
ViewToggle.displayName = "ViewToggle";
