import { HexagonCompassLabels } from "./HexagonCompassLabels";
import type { HexagonNodeVisualProps } from "./types";

export function HexagonNodeVisual({ selected }: HexagonNodeVisualProps) {
  return (
    <svg
      viewBox="0 0 100 100"
      className="absolute inset-0 w-full h-full drop-shadow-xl overflow-visible"
    >
      <polygon
        points="50,5 95,27.5 95,72.5 50,95 5,72.5 5,27.5"
        fill="transparent"
        stroke="currentColor"
        strokeWidth="1.2"
        className={`transition-[stroke,opacity] duration-500 ${
          selected
            ? "text-primary"
            : "text-muted-foreground/30 dark:text-white/20 group-hover:text-primary"
        }`}
      />
      <HexagonCompassLabels />
    </svg>
  );
}
