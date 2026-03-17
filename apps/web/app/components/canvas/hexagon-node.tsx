"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";

type NodeType =
  | "bounded-context"
  | "entity"
  | "port"
  | "use-case"
  | "adapter";

interface HexagonData extends Record<string, unknown> {
  label: string;
  type?: NodeType;
  isRoot?: boolean;
  side?: "north" | "south" | "east" | "west";
  category?: string;
}

// Visual tokens per type for rectangular nodes (all non-root nodes)
const RECT_STYLES: Record<
  NodeType,
  { fill: string; stroke: string; text: string; handleColor: string }
> = {
  "bounded-context": {
    fill: "bg-sky-500/10",
    stroke: "border-sky-500",
    text: "text-sky-700 dark:text-sky-400",
    handleColor: "!bg-sky-500",
  },
  entity: {
    fill: "bg-emerald-500/10",
    stroke: "border-emerald-500",
    text: "text-emerald-700 dark:text-emerald-400",
    handleColor: "!bg-emerald-500",
  },
  port: {
    fill: "bg-violet-500/10",
    stroke: "border-violet-500",
    text: "text-violet-700 dark:text-violet-400",
    handleColor: "!bg-violet-500",
  },
  "use-case": {
    fill: "bg-amber-500/10",
    stroke: "border-amber-500",
    text: "text-amber-700 dark:text-amber-400",
    handleColor: "!bg-amber-500",
  },
  adapter: {
    fill: "bg-blue-500/10",
    stroke: "border-blue-500",
    text: "text-blue-700 dark:text-blue-400",
    handleColor: "!bg-blue-500",
  },
};

function getSatelliteHandlePosition(side: string | undefined): Position {
  switch (side) {
    case "east":  return Position.Left;
    case "west":  return Position.Right;
    case "north": return Position.Bottom;
    case "south": return Position.Top;
    default:      return Position.Left;
  }
}

function HexagonNodeComponent({
  data,
  selected,
}: NodeProps<Node<HexagonData>>) {
  const nodeType = (data.type as NodeType) ?? "bounded-context";
  const isRoot = !!data.isRoot;
  const isHexagon = isRoot; // Only the root bounded-context renders as hexagon

  // Rectangular node (entity, port, use-case, adapter)
  if (!isHexagon) {
    const styles = RECT_STYLES[nodeType as Exclude<NodeType, "bounded-context">];
    return (
      <div
        style={{ width: 140, height: 72 }}
        className={`relative flex items-center justify-center rounded-md border-2 text-xs font-medium transition-colors select-none ${styles.fill} ${styles.stroke} ${styles.text} ${selected ? "ring-2 ring-ring ring-offset-2" : ""}`}
      >
        {data.category && (
          <span className="absolute -top-2.5 right-2 px-1.5 py-px text-[8px] font-mono bg-background border border-border text-muted-foreground rounded-sm truncate max-w-[100px]">
            {String(data.category)}
          </span>
        )}
        {!data.category && (
          <Handle
            type="target"
            position={Position.Top}
            className={`${styles.handleColor} !w-2.5 !h-2.5`}
          />
        )}
        <span className="px-3 truncate max-w-[120px] text-center leading-tight">
          {String(data.label || "")}
        </span>
        <Handle
          type="source"
          position={Position.Bottom}
          className={`${styles.handleColor} !w-2.5 !h-2.5`}
        />
      </div>
    );
  }

  // Hexagonal node (bounded-context) — root is 400px, satellite is 160px
  const dimension = isRoot ? 400 : 160;

  return (
    <div
      style={{ width: dimension, height: dimension }}
      className="relative flex items-center justify-center p-2 select-none group"
    >
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 w-full h-full drop-shadow-2xl overflow-visible"
      >
        <polygon
          points="50,5 95,27.5 95,72.5 50,95 5,72.5 5,27.5"
          fill="transparent"
          stroke={selected ? "#38bdf8" : "#000000"}
          strokeWidth={isRoot ? "1.5" : "2.2"}
          className="transition-all duration-500 group-hover:stroke-sky-400"
        />
        {isRoot && (
          <>
            <text x="50" y="-3" textAnchor="middle" fill="#475569" fontSize="4" fontFamily="monospace" letterSpacing="0.8" fontWeight="700">PRESENTATION</text>
            <text x="50" y="104" textAnchor="middle" fill="#475569" fontSize="4" fontFamily="monospace" letterSpacing="0.8" fontWeight="700">INFRASTRUCTURE</text>
            <text x="102" y="52" textAnchor="start" fill="#475569" fontSize="4" fontFamily="monospace" letterSpacing="0.8" fontWeight="700">DRIVING</text>
            <text x="-2" y="52" textAnchor="end" fill="#475569" fontSize="4" fontFamily="monospace" letterSpacing="0.8" fontWeight="700">EXTERNAL</text>
          </>
        )}
      </svg>

      <div
        className={`z-10 text-center flex flex-col items-center justify-center text-slate-900 dark:text-slate-100 uppercase tracking-widest leading-tight ${
          isRoot ? "text-2xl font-black italic" : "text-[10px] font-bold"
        }`}
      >
        {String(data.label || "")
          .split("\n")
          .map((line, i) => (
            <span
              key={i}
              className={
                i > 0
                  ? "opacity-50 text-[9px] lowercase mt-1 font-normal tracking-normal normal-case"
                  : ""
              }
            >
              {line}
            </span>
          ))}
      </div>

      {isRoot ? (
        <>
          <Handle
            type="target"
            position={Position.Top}
            id="north"
            className="!bg-sky-500 !w-3 !h-3 border-2 border-slate-900 shadow-[0_0_10px_rgba(56,189,248,0.5)]"
          />
          <Handle
            type="target"
            position={Position.Bottom}
            id="south"
            className="!bg-sky-500 !w-3 !h-3 border-2 border-slate-900 shadow-[0_0_10px_rgba(56,189,248,0.5)]"
          />
          <Handle
            type="target"
            position={Position.Left}
            id="west"
            className="!bg-sky-500 !w-3 !h-3 border-2 border-slate-900 shadow-[0_0_10px_rgba(56,189,248,0.5)]"
          />
          <Handle
            type="target"
            position={Position.Right}
            id="east"
            className="!bg-sky-500 !w-3 !h-3 border-2 border-slate-900 shadow-[0_0_10px_rgba(56,189,248,0.5)]"
          />
        </>
      ) : (
        <Handle
          type="source"
          position={getSatelliteHandlePosition(data.side)}
          className="!bg-slate-500 !w-2 !h-2 border border-slate-900"
        />
      )}
    </div>
  );
}

const HexagonNode = memo(HexagonNodeComponent);
HexagonNode.displayName = "HexagonNode";

export { HexagonNode };
export type { HexagonNodeProps };

interface HexagonNodeProps {
  data: HexagonData;
  selected?: boolean;
}
