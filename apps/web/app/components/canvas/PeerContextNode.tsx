"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";

export type PeerNodeData = {
  label: string;
  subtype?: "U" | "D" | "ACL" | "SK" | "P" | "OHS" | string;
  isPeer: boolean;
};

function PeerContextNodeComponent({ data }: NodeProps<Node<PeerNodeData>>) {
  const { label, subtype } = data;

  const relationshipLabels: Record<string, string> = {
    U: "Upstream",
    D: "Downstream",
    ACL: "Anti-Corruption Layer",
    SK: "Shared Kernel",
    P: "Partnership",
    OHS: "Open Host Service",
  };

  return (
    <div className="relative w-[180px] h-[180px] flex items-center justify-center">
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        <circle
          cx="90"
          cy="90"
          r="85"
          style={{
            fill: "hsl(var(--card) / 0.8)",
            stroke: "hsl(var(--border))",
          }}
          strokeWidth="2"
          strokeDasharray="6 4"
        />
      </svg>

      <div className="z-10 flex flex-col items-center px-4 text-center">
        <span className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-1">
          External Peer
        </span>

        <div className="text-sm font-bold text-foreground leading-tight mb-2">
          {label}
        </div>

        {subtype && (
          <div className="px-2 py-0.5 bg-muted rounded border border-border">
            <span className="text-[10px] font-mono font-medium text-muted-foreground">
              {relationshipLabels[subtype] || subtype}
            </span>
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="inbound-left"
        className="!bg-violet-500 !w-3 !h-3 !border-2 !border-background"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="outbound-right"
        className="!bg-amber-500 !w-3 !h-3 !border-2 !border-background"
      />
    </div>
  );
}

export const PeerContextNode = memo(PeerContextNodeComponent);
