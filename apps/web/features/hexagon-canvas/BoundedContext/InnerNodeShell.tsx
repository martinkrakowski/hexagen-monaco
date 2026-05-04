"use client";

import { Handle, Position } from "@xyflow/react";
import type { InnerNodeShellProps } from "./types";

export function InnerNodeShell({ data }: InnerNodeShellProps) {
  return (
    <div
      style={{ width: 140, height: 28 }}
      className="relative flex flex-col items-center justify-center select-none"
    >
      <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground/60">
        {String(data.label || "")}
      </span>
      <div className="w-full h-px bg-muted-foreground/20 mt-1" />
      <Handle
        type="source"
        position={Position.Bottom}
        id="south"
        className="!bg-muted-foreground/30 !w-2 !h-2"
      />
    </div>
  );
}
