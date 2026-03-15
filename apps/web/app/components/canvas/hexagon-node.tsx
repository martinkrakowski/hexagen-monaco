"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { HexagonNode as HexagonNodeData } from "@hexagen/visualization";

const hexagonVariants = cva(
  "relative flex items-center justify-center rounded-md border-2 text-center text-sm font-medium transition-colors",
  {
    variants: {
      variant: {
        "bounded-context": "border-primary bg-primary/10 text-primary",
        entity: "border-secondary bg-secondary/10 text-secondary-foreground",
        port: "border-accent bg-accent/10 text-accent-foreground",
        "use-case": "border-chart-1 bg-chart-1/10 text-chart-1",
      },
    },
    defaultVariants: {
      variant: "bounded-context",
    },
  },
);

interface HexagonNodeProps {
  data: HexagonNodeData;
  selected?: boolean;
}

function HexagonNodeComponent({ data, selected }: HexagonNodeProps) {
  const variant = data.type as VariantProps<typeof hexagonVariants>["variant"];

  return (
    <div
      className={cn(
        hexagonVariants({ variant }),
        selected && "ring-2 ring-ring ring-offset-2",
      )}
      style={{
        width: 120,
        height: 100,
        clipPath:
          "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-muted-foreground !w-3 !h-3"
      />
      <span className="px-2 truncate max-w-[100px]">{data.label}</span>
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
