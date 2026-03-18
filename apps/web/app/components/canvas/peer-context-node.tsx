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
          fill="rgba(248, 250, 252, 0.8)"
          stroke="#cbd5e1"
          strokeWidth="2"
          strokeDasharray="6 4"
        />
      </svg>

      <div className="z-10 flex flex-col items-center px-4 text-center">
        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1">
          External Peer
        </span>

        <div className="text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight mb-2">
          {label}
        </div>

        {subtype && (
          <div className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
            <span className="text-[10px] font-mono font-medium text-slate-500">
              {relationshipLabels[subtype] || subtype}
            </span>
          </div>
        )}
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="inbound-left"
        className="!bg-violet-500 !w-3 !h-3 !border-2 !border-white dark:!border-slate-900 shadow-sm"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="outbound-right"
        className="!bg-amber-500 !w-3 !h-3 !border-2 !border-white dark:!border-slate-900 shadow-sm"
      />
    </div>
  );
}

export const PeerContextNode = memo(PeerContextNodeComponent);
