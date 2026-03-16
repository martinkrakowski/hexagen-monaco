"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { cva, type VariantProps } from "class-variance-authority";
import { Database, Hexagon, Plug, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HexagonNode as HexagonNodeData } from "@hexagen/visualization";

const hexagonVariants = cva(
  "absolute inset-0 flex items-center justify-center rounded-md border-2 text-center text-xs font-medium transition-colors leading-tight",
  {
    variants: {
      variant: {
        "bounded-context":
          "border-ring bg-ring/20 text-foreground",
        entity:
          "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
        "use-case":
          "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400",
        port:
          "border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-400",
      },
    },
    defaultVariants: {
      variant: "bounded-context",
    },
  },
);

const iconVariants = cva("", {
  variants: {
    variant: {
      "bounded-context": "text-ring",
      entity: "text-emerald-500",
      "use-case": "text-amber-500",
      port: "text-violet-500",
    },
  },
  defaultVariants: {
    variant: "bounded-context",
  },
});

const NODE_ICONS = {
  "bounded-context": Hexagon,
  entity: Database,
  "use-case": Workflow,
  port: Plug,
} as const;

const CLIP_PATH =
  "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";

interface HexagonNodeProps {
  data: HexagonNodeData;
  selected?: boolean;
}

function HexagonNodeComponent({ data, selected }: HexagonNodeProps) {
  const variant = data.type as VariantProps<typeof hexagonVariants>["variant"];
  const Icon = NODE_ICONS[data.type as keyof typeof NODE_ICONS] ?? Hexagon;

  return (
    <div className="relative" style={{ width: 120, height: 100 }}>
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-muted-foreground !w-3 !h-3"
      />

      {/* Clipped hexagon shape */}
      <div
        className={cn(
          hexagonVariants({ variant }),
          selected && "ring-2 ring-ring ring-offset-2",
        )}
        style={{ clipPath: CLIP_PATH }}
      >
        <span className="px-3 truncate max-w-[90px]">{data.label}</span>
      </div>

      {/* Type icon — on outer wrapper so it isn't clipped */}
      <div
        className={cn(
          "absolute z-10 pointer-events-none",
          iconVariants({ variant }),
        )}
        style={{ top: 26, right: 5 }}
      >
        <Icon size={11} strokeWidth={2.5} />
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-muted-foreground !w-3 !h-3"
      />
    </div>
  );
}

const HexagonNode = memo(HexagonNodeComponent);
HexagonNode.displayName = "HexagonNode";

export { HexagonNode };
export type { HexagonNodeProps };
