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
    <div className="relative w-44 h-44 flex items-center justify-center shadow-lg">
      <svg className="absolute inset-0 w-full h-full pointer-events-none">
        <circle
          cx="90"
          cy="90"
          r="85"
          style={{
            fill: "hsl(var(--card))",
            stroke: "hsl(var(--border))",
          }}
          strokeWidth="2"
          strokeDasharray="8 3"
        />
      </svg>

      <div className="z-10 flex flex-col items-center px-4 text-center">
         <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">
           External Peer
         </span>

        <div className="text-sm font-bold text-foreground leading-tight mb-2">
          {label}
        </div>

        {subtype && (
          <div className="px-2 py-0.5 bg-muted rounded border border-border">
             <span className="text-xs font-mono font-medium text-muted-foreground">
               {relationshipLabels[subtype] || subtype}
             </span>
          </div>
        )}
      </div>

      <Handle
         type="target"
         position={Position.Left}
         id="inbound-left"
         className="!bg-info !w-3 !h-3 !border-2 !border-background"
       />
       <Handle
         type="source"
         position={Position.Right}
         id="outbound-right"
         className="!bg-warning !w-3 !h-3 !border-2 !border-background"
       />
    </div>
  );
}

export const PeerContextNode = memo(PeerContextNodeComponent);
