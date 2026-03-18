"use client";

import { memo, useState } from "react";
import { createPortal } from "react-dom";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { Package, Gem, Zap, Settings2, X } from "lucide-react";
import type { DomainEventRef } from "@hexagen/shared";

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
  isPeer?: boolean;
  side?: "north" | "south" | "east" | "west";
  category?: string;
  stats?: {
    aggregates?: number;
    aggregateItems?: string[];
    valueObjects?: number;
    valueObjectItems?: string[];
    events?: number;
    eventItems?: string[];
    services?: number;
    serviceItems?: string[];
  };
  publishedEvents?: DomainEventRef[];
  subscribedEvents?: DomainEventRef[];
}

const DOMAIN_COMPASS = [
  { key: "aggregates",   itemsKey: "aggregateItems",   label: "Aggregates",   Icon: Package,   color: "text-amber-400"   },
  { key: "valueObjects", itemsKey: "valueObjectItems", label: "Value Objects", Icon: Gem,       color: "text-emerald-400" },
  { key: "events",       itemsKey: "eventItems",       label: "Events",        Icon: Zap,       color: "text-purple-400"  },
  { key: "services",     itemsKey: "serviceItems",     label: "Services",      Icon: Settings2, color: "text-sky-400"     },
] as const;

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

type CompassKey = (typeof DOMAIN_COMPASS)[number]["label"];
type CompassCountKey = (typeof DOMAIN_COMPASS)[number]["key"];
type CompassItemsKey = (typeof DOMAIN_COMPASS)[number]["itemsKey"];
type NodeStats = NonNullable<HexagonData["stats"]>;

function getStatCount(stats: NodeStats | undefined, key: CompassCountKey): number {
  return stats?.[key] ?? 0;
}
function getStatItems(stats: NodeStats | undefined, key: CompassItemsKey): string[] {
  return stats?.[key] ?? [];
}

/**
 * Distributes up to 5 event handles evenly across the flat left/right face of
 * the hexagon. The safe vertical zone runs from y=27.5% to y=72.5% (a 45-unit
 * span in the 100-unit viewBox). Slots are centred within that zone using:
 *   startY = 50 - ((count - 1) * 7.5) / 2
 * ensuring handles never bleed into the slanted corners.
 */
function getSlottedOffsets(count: number): string[] {
  const safeCount = Math.min(count, 5);
  const startY = 50 - ((safeCount - 1) * 7.5) / 2;
  return Array.from({ length: safeCount }, (_, i) => `${startY + i * 7.5}%`);
}

interface CompassModalProps {
  label: CompassKey | string;
  items: string[];
  onClose: () => void;
}

function CompassModal({ label, items, onClose }: CompassModalProps) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-80 rounded-xl border border-border bg-background shadow-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X size={16} />
        </button>
        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4">
          {label}
        </h3>
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No items defined.</p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((item, i) => (
              <li
                key={`${item}-${i}`}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm bg-muted/50 text-foreground border border-border/50"
              >
                <span className="text-[10px] font-mono text-muted-foreground w-4 shrink-0">{i + 1}</span>
                {item}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}

function HexagonNodeComponent({
  data,
  selected,
}: NodeProps<Node<HexagonData>>) {
  const nodeType = (data.type as NodeType) ?? "bounded-context";
  const isRoot = !!data.isRoot;
  const isPeer = !!data.isPeer;
  const isHexagon = isRoot || isPeer; // Root and peer bounded-contexts render as hexagons
  const [activeCompass, setActiveCompass] = useState<{ label: string; items: string[] } | null>(null);

  // Rectangular node (entity, port, use-case, adapter)
  if (!isHexagon) {
    const styles = RECT_STYLES[nodeType as Exclude<NodeType, "bounded-context">];
    // Inner category nodes (parentId set) render as compact labels — smaller so
    // they stay within the hexagon polygon boundary without clipping.
    const isInner = !!data.parentId;
    const nodeWidth = isInner ? 120 : 140;
    const nodeHeight = isInner ? 36 : 72;
    return (
      <div
        style={{ width: nodeWidth, height: nodeHeight }}
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
        <span className={`px-2 truncate text-center leading-tight ${isInner ? "max-w-[100px]" : "max-w-[120px]"}`}>
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

  // Hexagonal node: root = 500px, peer BC = 300px, infrastructure satellite = 160px
  const dimension = isRoot ? 500 : isPeer ? 300 : 160;

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
          strokeWidth={isRoot ? "0.8" : isPeer ? "1.2" : "2.2"}
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

      <div className="z-10 flex flex-col items-center justify-center gap-3">
        {/* Project name */}
        <div
          className={`text-center text-slate-900 dark:text-slate-100 uppercase tracking-widest leading-tight ${
            isRoot ? "text-base font-black italic" : isPeer ? "text-sm font-bold italic" : "text-[10px] font-bold"
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

        {/* Domain Compass — root and peer nodes */}
        {(isRoot || isPeer) && (
          <div className={`grid grid-cols-2 ${isPeer ? "gap-x-6 gap-y-3" : "gap-x-10 gap-y-5"}`}>
            {DOMAIN_COMPASS.map(({ key, itemsKey, label, Icon, color }) => (
              <div
                key={key}
                className="flex flex-col items-center opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
                onClick={() =>
                  setActiveCompass({
                    label,
                    items: getStatItems(data.stats, itemsKey),
                  })
                }
              >
                <Icon size={16} className={color} />
                <span className="text-[7px] uppercase tracking-tighter font-bold text-slate-500 mt-1">{label}</span>
                <span className="text-xs font-mono text-slate-900 dark:text-slate-100">
                  {getStatCount(data.stats, key)}
                </span>
              </div>
            ))}
          </div>
        )}
        {activeCompass && (
          <CompassModal
            label={activeCompass.label}
            items={activeCompass.items}
            onClose={() => setActiveCompass(null)}
          />
        )}
      </div>

      {isRoot ? (
        <>
          {/* Infrastructure cardinal handles */}
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
          {/* Dynamic event handles — published (right face, amber) */}
          {(data.publishedEvents ?? []).slice(0, 5).map((evt, i) => (
            <Handle
              key={evt.id}
              type="source"
              position={Position.Right}
              id={evt.id}
              style={{ top: getSlottedOffsets((data.publishedEvents ?? []).length)[i] }}
              className="!bg-amber-500 !w-2.5 !h-2.5 !border !border-slate-900 !rounded-sm"
              title={`Publishes: ${evt.label}`}
            />
          ))}
          {/* Dynamic event handles — subscribed (left face, violet) */}
          {(data.subscribedEvents ?? []).slice(0, 5).map((evt, i) => (
            <Handle
              key={evt.id}
              type="target"
              position={Position.Left}
              id={evt.id}
              style={{ top: getSlottedOffsets((data.subscribedEvents ?? []).length)[i] }}
              className="!bg-violet-500 !w-2.5 !h-2.5 !border !border-slate-900 !rounded-sm"
              title={`Subscribes to: ${evt.label}`}
            />
          ))}
        </>
      ) : isPeer ? (
        <>
          {/* Dynamic event handles — published (right face, amber) */}
          {(data.publishedEvents ?? []).slice(0, 5).map((evt, i) => (
            <Handle
              key={evt.id}
              type="source"
              position={Position.Right}
              id={evt.id}
              style={{ top: getSlottedOffsets((data.publishedEvents ?? []).length)[i] }}
              className="!bg-amber-500 !w-2.5 !h-2.5 !border !border-slate-900 !rounded-sm"
              title={`Publishes: ${evt.label}`}
            />
          ))}
          {/* Dynamic event handles — subscribed (left face, violet) */}
          {(data.subscribedEvents ?? []).slice(0, 5).map((evt, i) => (
            <Handle
              key={evt.id}
              type="target"
              position={Position.Left}
              id={evt.id}
              style={{ top: getSlottedOffsets((data.subscribedEvents ?? []).length)[i] }}
              className="!bg-violet-500 !w-2.5 !h-2.5 !border !border-slate-900 !rounded-sm"
              title={`Subscribes to: ${evt.label}`}
            />
          ))}
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
