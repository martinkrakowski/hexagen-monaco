"use client";

import { memo, useState } from "react";
import { createPortal } from "react-dom";
import { Handle, Position } from "@xyflow/react";
import { Package, Gem, Zap, Settings2, X } from "lucide-react";
import type { DomainEventRef } from "@hexagen/shared";

interface BoundedContextData extends Record<string, unknown> {
  label: string;
  type?:
    | "bounded-context"
    | "entity"
    | "port"
    | "use-case"
    | "adapter"
    | "inner";
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
  parentId?: string;
}

// Visual tokens per type for rectangular nodes (all non-root nodes)
const RECT_STYLES: Record<
  "entity" | "port" | "use-case" | "adapter",
  { fill: string; stroke: string; text: string; handleColor: string }
> = {
  entity: {
    fill: "bg-emerald-500/10 dark:bg-emerald-500/20",
    stroke: "border-emerald-500",
    text: "text-emerald-700 dark:text-emerald-400",
    handleColor: "!bg-emerald-500",
  },
  port: {
    fill: "bg-violet-500/10 dark:bg-violet-500/20",
    stroke: "border-violet-500",
    text: "text-violet-700 dark:text-violet-400",
    handleColor: "!bg-violet-500",
  },
  "use-case": {
    fill: "bg-amber-500/10 dark:bg-amber-500/20",
    stroke: "border-amber-500",
    text: "text-amber-700 dark:text-amber-400",
    handleColor: "!bg-amber-500",
  },
  adapter: {
    fill: "bg-blue-500/10 dark:bg-blue-500/20",
    stroke: "border-blue-500",
    text: "text-blue-700 dark:text-blue-400",
    handleColor: "!bg-blue-500",
  },
};

// Visual tokens for bounded-context and inner types
const BC_STYLES = {
  "bounded-context": {
    fill: "bg-sky-500/10 dark:bg-sky-500/20",
    stroke: "border-sky-500",
    text: "text-sky-700 dark:text-sky-400",
    handleColor: "!bg-sky-500",
  },
  inner: {
    fill: "bg-slate-500/10 dark:bg-slate-500/20",
    stroke: "border-slate-500",
    text: "text-slate-700 dark:text-slate-400",
    handleColor: "!bg-slate-500",
  },
};

const DOMAIN_COMPASS = [
  {
    key: "aggregates",
    itemsKey: "aggregateItems",
    label: "Aggregates",
    Icon: Package,
    color: "text-amber-400",
  },
  {
    key: "valueObjects",
    itemsKey: "valueObjectItems",
    label: "Value Objects",
    Icon: Gem,
    color: "text-emerald-400",
  },
  {
    key: "events",
    itemsKey: "eventItems",
    label: "Events",
    Icon: Zap,
    color: "text-purple-400",
  },
  {
    key: "services",
    itemsKey: "serviceItems",
    label: "Services",
    Icon: Settings2,
    color: "text-sky-400",
  },
] as const;

// Helper functions for stats
type CompassKey = (typeof DOMAIN_COMPASS)[number]["label"];
type CompassCountKey = (typeof DOMAIN_COMPASS)[number]["key"];
type CompassItemsKey = (typeof DOMAIN_COMPASS)[number]["itemsKey"];
type NodeStats = NonNullable<BoundedContextData["stats"]>;

function getStatCount(
  stats: NodeStats | undefined,
  key: CompassCountKey,
): number {
  return stats?.[key] ?? 0;
}

function getStatItems(
  stats: NodeStats | undefined,
  key: CompassItemsKey,
): string[] {
  return stats?.[key] ?? [];
}

// Helper function for slotted event handles
function getSlottedOffsets(count: number): string[] {
  const safeCount = Math.min(count, 5);
  const startY = 50 - ((safeCount - 1) * 7.5) / 2;
  return Array.from({ length: safeCount }, (_, i) => `${startY + i * 7.5}%`);
}

// Compass modal component
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
          <p className="text-xs text-muted-foreground italic">
            No items defined.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((item, i) => (
              <li
                key={`${item}-${i}`}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm bg-muted/50 text-foreground border border-border/50"
              >
                <span className="text-[10px] font-mono text-muted-foreground w-4 shrink-0">
                  {i + 1}
                </span>
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

interface UnifiedBoundedContextProps {
  data: BoundedContextData;
  selected?: boolean;
}

function UnifiedBoundedContextComponent({
  data,
  selected = false,
}: UnifiedBoundedContextProps) {
  const nodeType =
    (data.type as Exclude<BoundedContextData["type"], undefined>) ??
    "bounded-context";
  const isPeer = !!data.isPeer;
  const isHexagon = nodeType === "bounded-context" && !isPeer;
  const [activeCompass, setActiveCompass] = useState<{
    label: string;
    items: string[];
  } | null>(null);

  // Rectangular node (entity, port, use-case, adapter)
  if (!isHexagon) {
    // Determine styles based on node type
    const styles =
      nodeType === "inner"
        ? BC_STYLES.inner
        : nodeType === "entity"
          ? RECT_STYLES.entity
          : nodeType === "port"
            ? RECT_STYLES.port
            : nodeType === "use-case"
              ? RECT_STYLES["use-case"]
              : nodeType === "adapter"
                ? RECT_STYLES.adapter
                : BC_STYLES["bounded-context"];

    // Inner category nodes (parentId set) render as compact labels
    const isInner = !!data.parentId;
    const isDomainOrUseCases = nodeType === "inner";

    // Standalone port/adapters get cardinal handles for edge connections
    if (nodeType === "port" && !isInner) {
      const side = data.side as "north" | "south" | undefined;
      const showNorth = side === "north";
      const showSouth = side === "south";

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
          {/* North handle: adapter connects TO hexagon, so adapter needs SOURCE handle */}
          {showNorth && (
            <Handle
              type="source"
              position={Position.Top}
              id="north"
              className={`${styles.handleColor} !w-3 !h-3 border-2 border-slate-900 shadow-[0_0_10px_rgba(56,189,248,0.5)]`}
            />
          )}
          {/* South handle: hexagon connects TO adapter, so adapter needs TARGET handle */}
          {showSouth && (
            <Handle
              type="target"
              position={Position.Bottom}
              id="south"
              className={`${styles.handleColor} !w-3 !h-3 border-2 border-slate-900 shadow-[0_0_10px_rgba(56,189,248,0.5)]`}
            />
          )}
          {/* Default left/right handles for horizontal connections */}
          {!showNorth && !showSouth && (
            <>
              <Handle
                type="target"
                position={Position.Left}
                id="west"
                className={`${styles.handleColor} !w-3 !h-3 border-2 border-slate-900 shadow-[0_0_10px_rgba(56,189,248,0.5)]`}
              />
              <Handle
                type="source"
                position={Position.Right}
                id="east"
                className={`${styles.handleColor} !w-3 !h-3 border-2 border-slate-900 shadow-[0_0_10px_rgba(56,189,248,0.5)]`}
              />
            </>
          )}
          <span className={`px-2 truncate text-center leading-tight`}>
            {String(data.label || "")}
          </span>
        </div>
      );
    }

    // Entity/use-case satellites (with or without category) get top/bottom handles
    // Inner nodes (Domain/Use Cases static nodes) also get handles regardless of category
    const nodeWidth = isInner ? 120 : 140;
    const nodeHeight = isInner ? 36 : 72;

    return (
      <div
        style={{ width: nodeWidth, height: nodeHeight }}
        className={`relative flex items-center justify-center rounded-md border-2 text-xs font-medium transition-colors select-none ${styles.fill} ${styles.stroke} ${styles.text} ${selected ? "ring-2 ring-ring ring-offset-2" : ""}`}
      >
        {data.category && !isDomainOrUseCases && (
          <span className="absolute -top-2.5 right-2 px-1.5 py-px text-[8px] font-mono bg-background border border-border text-muted-foreground rounded-sm truncate max-w-[100px]">
            {String(data.category)}
          </span>
        )}
        {/* Top handle for parent connection - render for all non-entity/use-case nodes */}
        {!isDomainOrUseCases && (
          <Handle
            type="target"
            position={Position.Top}
            id="north"
            className={`${styles.handleColor} !w-2.5 !h-2.5`}
          />
        )}
        {/* Inner nodes (Domain/Use Cases) always render west/east handles */}
        {isDomainOrUseCases && (
          <>
            {/* Left handle for domain nodes (west connection to parent hexagon) */}
            <Handle
              type="target"
              position={Position.Left}
              id="west"
              className={`${styles.handleColor} !w-2.5 !h-2.5`}
            />
            {/* Right handle for use cases nodes (east connection to children) */}
            <Handle
              type="source"
              position={Position.Right}
              id="east"
              className={`${styles.handleColor} !w-2.5 !h-2.5`}
            />
          </>
        )}
        <span
          className={`px-2 truncate text-center leading-tight ${isInner ? "max-w-[100px]" : "max-w-[120px]"}`}
        >
          {String(data.label || "")}
        </span>
        {/* Bottom handle for child connections */}
        <Handle
          type="source"
          position={Position.Bottom}
          id="south"
          className={`${styles.handleColor} !w-2.5 !h-2.5`}
        />
      </div>
    );
  }

  // Hexagonal node: all contexts use same size as root for consistency
  const dimension = 500;

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
          stroke={selected ? "#38bdf8" : "currentColor"}
          strokeWidth="2.2"
          className="text-muted-foreground/30 dark:text-white/20 transition-all duration-500 group-hover:stroke-sky-400"
        />
        {/* Quadrant labels - always show for all contexts */}
        <text
          x="50"
          y="-3"
          textAnchor="middle"
          fill="#475569"
          fontSize="4"
          fontFamily="monospace"
          letterSpacing="0.8"
          fontWeight="700"
        >
          PRESENTATION
        </text>
        <text
          x="50"
          y="104"
          textAnchor="middle"
          fill="#475569"
          fontSize="4"
          fontFamily="monospace"
          letterSpacing="0.8"
          fontWeight="700"
        >
          INFRASTRUCTURE
        </text>
        <text
          x="-2"
          y="52"
          textAnchor="end"
          fill="#475569"
          fontSize="4"
          fontFamily="monospace"
          letterSpacing="0.8"
          fontWeight="700"
        >
          DRIVING
        </text>
        <text
          x="108"
          y="52"
          textAnchor="start"
          fill="#475569"
          fontSize="4"
          fontFamily="monospace"
          letterSpacing="0.8"
          fontWeight="700"
        >
          DRIVEN
        </text>
      </svg>

      <div className="z-10 flex flex-col items-center justify-center gap-3">
        {/* Project name */}
        <div className="text-center text-slate-900 dark:text-slate-100 uppercase tracking-widest leading-tight text-base font-black italic">
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

        {/* Domain Compass — always show for all contexts */}
        <div className="grid grid-cols-2 gap-x-10 gap-y-5">
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
              <span className="text-[7px] uppercase tracking-tighter font-bold text-muted-foreground mt-1">
                {label}
              </span>
              <span className="text-xs font-mono text-foreground">
                {getStatCount(data.stats, key)}
              </span>
            </div>
          ))}
        </div>
        {activeCompass && (
          <CompassModal
            label={activeCompass.label}
            items={activeCompass.items}
            onClose={() => setActiveCompass(null)}
          />
        )}
      </div>

      {/* All hexagonal contexts get the same handle configuration */}
      <>
        {/* North: target handles for multiple API/UI adapters */}
        <Handle
          type="target"
          position={Position.Top}
          id="north-0"
          className="!bg-sky-500 !w-3 !h-3 border-2 border-slate-900 shadow-[0_0_10px_rgba(56,189,248,0.5)]"
        />
        <Handle
          type="target"
          position={Position.Top}
          id="north-1"
          className="!bg-sky-500 !w-3 !h-3 border-2 border-slate-900 shadow-[0_0_10px_rgba(56,189,248,0.5)]"
          style={{ left: "60%" }}
        />
        {/* South: source handles for multiple Messaging/Persistence adapters */}
        <Handle
          type="source"
          position={Position.Bottom}
          id="south-0"
          className="!bg-sky-500 !w-3 !h-3 border-2 border-slate-900 shadow-[0_0_10px_rgba(56,189,248,0.5)]"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          id="south-1"
          className="!bg-sky-500 !w-3 !h-3 border-2 border-slate-900 shadow-[0_0_10px_rgba(56,189,248,0.5)]"
          style={{ left: "60%" }}
        />
        {/* West: target handle for upstream peer connections */}
        <Handle
          type="target"
          position={Position.Left}
          id="west"
          className="!bg-sky-500 !w-3 !h-3 border-2 border-slate-900 shadow-[0_0_10px_rgba(56,189,248,0.5)]"
        />
        {/* East: source handle for downstream peer connections */}
        <Handle
          type="source"
          position={Position.Right}
          id="east"
          className="!bg-sky-500 !w-3 !h-3 border-2 border-slate-900"
        />
        {/* Dynamic event handles — published (right face, amber) */}
        {(data.publishedEvents ?? []).slice(0, 5).map((evt, i) => (
          <Handle
            key={evt.id}
            type="source"
            position={Position.Right}
            id={evt.id}
            style={{
              top: getSlottedOffsets((data.publishedEvents ?? []).length)[i],
            }}
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
            style={{
              top: getSlottedOffsets((data.subscribedEvents ?? []).length)[i],
            }}
            className="!bg-violet-500 !w-2.5 !h-2.5 !border !border-slate-900 !rounded-sm"
            title={`Subscribes to: ${evt.label}`}
          />
        ))}
      </>
    </div>
  );
}

const UnifiedBoundedContext = memo(UnifiedBoundedContextComponent);

UnifiedBoundedContext.displayName = "UnifiedBoundedContext";

export { UnifiedBoundedContext };
export type { UnifiedBoundedContextProps };
