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
      className="w-full h-full border-2 border-dashed border-border rounded-3xl pointer-events-none"
      style={{ width, height }}
    >
      <div className="absolute top-6 right-8 text-right">
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
