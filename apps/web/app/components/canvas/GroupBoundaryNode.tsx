import { memo } from "react";
import { type NodeProps, type Node } from "@xyflow/react";

export type GroupBoundaryData = {
  label: string;
  style?: { width?: number; height?: number; zIndex?: number };
};

function GroupBoundaryNodeComponent({
  data,
}: NodeProps<Node<GroupBoundaryData>>) {
  const width = data.style?.width || 800;
  const height = data.style?.height || 600;

  return (
    <div
      className="w-full h-full bg-card/[0.015] border border-dashed border-border/50 rounded-3xl pointer-events-none"
      style={{ width, height, backgroundColor: "transparent" }}
    >
      <div className="absolute top-5 left-6 text-left">
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">
          {data.label}
        </div>
        <div className="text-[9px] text-muted-foreground/60 italic">
          Governance Zone • Internal Bounded Contexts
        </div>
      </div>
    </div>
  );
}

export const GroupBoundaryNode = memo(GroupBoundaryNodeComponent);
