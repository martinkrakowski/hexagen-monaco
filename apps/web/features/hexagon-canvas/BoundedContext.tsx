"use client";

import { memo, useState } from "react";
import { createPortal } from "react-dom";
import { Handle, Position } from "@xyflow/react";
import { Package, Gem, Zap, Settings2, X } from "lucide-react";
import type { DomainEventRef } from "@hexagen/shared";
import type {
  VisualVariant,
  VisualVariantCategory,
} from "@hexagen/ui-projection-compiler";
import { CvaVariantResolverAdapter } from "@hexagen/ui-projection-compiler";

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

// Composition root: the CvaVariantResolverAdapter is injected here by the
// ui-projection-compiler. No more hard-coded palette maps in feature code —
// every visual variant flows through the compiler.
const variantResolver = new CvaVariantResolverAdapter();

const KNOWN_CATEGORIES: readonly VisualVariantCategory[] = [
  "driving",
  "driven",
  "presentation",
  "infrastructure",
  "entity",
  "value-object",
  "port",
  "use-case",
  "adapter",
  "domain-event",
  "policy",
  "aggregate",
  "service",
  "default",
] as const;

function isKnownCategory(key: string): key is VisualVariantCategory {
  return (KNOWN_CATEGORIES as readonly string[]).includes(key);
}

function resolveVariantForNodeType(
  nodeType: Exclude<
    BoundedContextData["type"],
    undefined | "bounded-context" | "inner"
  >,
): VisualVariant {
  const category: VisualVariantCategory =
    nodeType === "entity"
      ? "entity"
      : nodeType === "port"
        ? "port"
        : nodeType === "use-case"
          ? "use-case"
          : "adapter";
  return variantResolver.resolve(category);
}

function getPortCategoryStyle(
  category: string | undefined,
): VisualVariant | null {
  if (!category) return null;
  const key = category.toLowerCase();
  if (!isKnownCategory(key)) return null;
  return variantResolver.resolve(key);
}

const DOMAIN_COMPASS = [
  {
    key: "aggregates",
    itemsKey: "aggregateItems",
    label: "Aggregates",
    Icon: Package,
    color: "text-amber-500",
  },
  {
    key: "valueObjects",
    itemsKey: "valueObjectItems",
    label: "Value Objects",
    Icon: Gem,
    color: "text-emerald-500",
  },
  {
    key: "events",
    itemsKey: "eventItems",
    label: "Events",
    Icon: Zap,
    color: "text-violet-500",
  },
  {
    key: "services",
    itemsKey: "serviceItems",
    label: "Services",
    Icon: Settings2,
    color: "text-sky-500",
  },
] as const;

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--overlay)/0.4)] backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <div
        role="document"
        aria-label={label}
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
            {items.map((item, idx) => (
              <li
                key={`${label}-${item}`}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm bg-muted/50 text-foreground border border-border/50"
              >
                <span className="text-[10px] font-mono text-muted-foreground w-4 shrink-0">
                  {idx + 1}
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

  // Inner nodes (Domain / Use Cases) — column header labels (28px height)
  if (nodeType === "inner") {
    return (
      <div
        style={{ width: 140, height: 28 }}
        className="relative flex flex-col items-center justify-center select-none"
      >
        <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-muted-foreground/60">
          {String(data.label || "")}
        </span>
        <div className="w-full h-px bg-muted-foreground/20 mt-1" />
        {/* South handle for entity/use-case connections */}
        <Handle
          type="source"
          position={Position.Bottom}
          id="south"
          className="!bg-muted-foreground/30 !w-2 !h-2"
        />
      </div>
    );
  }

  // Two-zone satellite card nodes (entity, port, use-case, adapter — NOT inner)
  if (!isHexagon) {
    const styles =
      nodeType === "entity" ||
      nodeType === "port" ||
      nodeType === "use-case" ||
      nodeType === "adapter"
        ? resolveVariantForNodeType(nodeType)
        : variantResolver.resolve("entity");

    // Port nodes with north/south handles
    if (nodeType === "port") {
      const side = data.side as "north" | "south" | undefined;
      const showNorth = side === "north";
      const showSouth = side === "south";

      const categoryStyle = getPortCategoryStyle(data.category);
      const stylesToUse = categoryStyle ?? styles;

      return (
        <div
          style={{ width: 140, height: 72 }}
          className={`relative rounded-lg border overflow-hidden transition-colors select-none ${stylesToUse.bodyBg} ${stylesToUse.border} ${selected ? "ring-2 ring-ring ring-offset-1 ring-offset-background" : ""}`}
        >
          {/* Header zone — category as label */}
          <div
            className={`h-7 ${stylesToUse.headerBg} flex items-center justify-center ${stylesToUse.headerText} text-xs font-semibold truncate px-2`}
          >
            {data.category ? String(data.category).toUpperCase() : "PORT"}
          </div>
          {/* Body zone — service name as plain text */}
          <div className="h-[calc(100%-28px)] flex items-center justify-center px-2">
            <span className="text-xs font-medium text-foreground text-center truncate">
              {String(data.label || "")}
            </span>
          </div>
          {/* Handles */}
          {showNorth && (
            <Handle
              type="source"
              position={Position.Top}
              id="north"
              className={`${stylesToUse.handleColor} !w-3 !h-3 border-2 border-background`}
            />
          )}
          {showSouth && (
            <Handle
              type="target"
              position={Position.Bottom}
              id="south"
              className={`${stylesToUse.handleColor} !w-3 !h-3 border-2 border-background`}
            />
          )}
          {!showNorth && !showSouth && (
            <>
              <Handle
                type="target"
                position={Position.Left}
                id="west"
                className={`${stylesToUse.handleColor} !w-3 !h-3 border-2 border-background`}
              />
              <Handle
                type="source"
                position={Position.Right}
                id="east"
                className={`${stylesToUse.handleColor} !w-3 !h-3 border-2 border-background`}
              />
            </>
          )}
        </div>
      );
    }

    // Entity / use-case / adapter nodes with north/south handles
    const nodeWidth = 140;
    const nodeHeight = 72;

    return (
      <div
        style={{ width: nodeWidth, height: nodeHeight }}
        className={`relative rounded-lg border overflow-hidden transition-colors select-none ${styles.bodyBg} ${styles.border} ${selected ? "ring-2 ring-ring ring-offset-1 ring-offset-background" : ""}`}
      >
        {/* Header zone — category as label */}
        <div
          className={`h-7 ${styles.headerBg} flex items-center justify-center ${styles.headerText} text-xs font-semibold truncate px-2`}
        >
          {data.category
            ? String(data.category).toUpperCase()
            : nodeType.toUpperCase()}
        </div>
        {/* Body zone — label as plain text */}
        <div className="h-[calc(100%-28px)] flex items-center justify-center px-2">
          <span className="text-xs font-medium text-foreground text-center truncate">
            {String(data.label || "")}
          </span>
        </div>
        {/* Handles */}
        <Handle
          type="target"
          position={Position.Top}
          id="north"
          className={`${styles.handleColor} !w-2.5 !h-2.5`}
        />
        <Handle
          type="source"
          position={Position.Bottom}
          id="south"
          className={`${styles.handleColor} !w-2.5 !h-2.5`}
        />
      </div>
    );
  }

  // Hexagonal bounded context — minimal visual tweaks to existing design
  const dimension = 500;

  return (
    <div
      style={{ width: dimension, height: dimension }}
      className="relative flex items-center justify-center p-2 select-none group"
    >
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 w-full h-full drop-shadow-xl overflow-visible"
      >
        <polygon
          points="50,5 95,27.5 95,72.5 50,95 5,72.5 5,27.5"
          fill="transparent"
          stroke="currentColor"
          strokeWidth="1.2"
          className={`transition-[stroke,opacity] duration-500 ${
            selected
              ? "text-primary"
              : "text-muted-foreground/30 dark:text-white/20 group-hover:text-primary"
          }`}
        />
        <g className="fill-muted-foreground">
          <text
            x="50"
            y="-3"
            textAnchor="middle"
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
            fontSize="4"
            fontFamily="monospace"
            letterSpacing="0.8"
            fontWeight="700"
          >
            DRIVEN
          </text>
        </g>
      </svg>

      <div className="z-10 flex flex-col items-center justify-center gap-3">
        <div className="text-center text-foreground uppercase tracking-widest leading-tight text-base font-black italic">
          {String(data.label || "")
            .split("\n")
            .map((line, lineIdx) => (
              <span
                key={`${line}-${lineIdx}`}
                className={
                  lineIdx > 0
                    ? "opacity-50 text-[9px] lowercase mt-1 font-normal tracking-normal normal-case"
                    : ""
                }
              >
                {line}
              </span>
            ))}
        </div>

        <div className="grid grid-cols-2 gap-x-10 gap-y-5">
          {DOMAIN_COMPASS.map(({ key, itemsKey, label, Icon, color }) => (
            <button
              key={key}
              type="button"
              className="flex flex-col items-center opacity-70 hover:opacity-100 transition-opacity cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              onClick={() =>
                setActiveCompass({
                  label,
                  items: getStatItems(data.stats, itemsKey),
                })
              }
              aria-label={`View ${label}`}
            >
              <Icon size={16} className={color} />
              <span className="text-[7px] uppercase tracking-tighter font-bold text-muted-foreground mt-1">
                {label}
              </span>
              <span className="text-xs font-mono text-foreground">
                {getStatCount(data.stats, key)}
              </span>
            </button>
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

      <>
        <Handle
          type="target"
          position={Position.Top}
          id="north-0"
          className="!bg-sky-500 !w-3 !h-3 border-2 border-background shadow-[0_0_10px_hsl(var(--ring)/0.5)]"
        />
        <Handle
          type="target"
          position={Position.Top}
          id="north-1"
          className="!bg-sky-500 !w-3 !h-3 border-2 border-background shadow-[0_0_10px_hsl(var(--ring)/0.5)]"
          style={{ left: "60%" }}
        />
        <Handle
          type="source"
          position={Position.Bottom}
          id="south-0"
          className="!bg-sky-500 !w-3 !h-3 border-2 border-background shadow-[0_0_10px_hsl(var(--ring)/0.5)]"
        />
        <Handle
          type="source"
          position={Position.Bottom}
          id="south-1"
          className="!bg-sky-500 !w-3 !h-3 border-2 border-background shadow-[0_0_10px_hsl(var(--ring)/0.5)]"
          style={{ left: "35%" }}
        />
        <Handle
          type="source"
          position={Position.Bottom}
          id="south-2"
          className="!bg-sky-500 !w-3 !h-3 border-2 border-background shadow-[0_0_10px_hsl(var(--ring)/0.5)]"
          style={{ left: "70%" }}
        />
        <Handle
          type="target"
          position={Position.Left}
          id="west"
          className="!bg-sky-500 !w-3 !h-3 border-2 border-background shadow-[0_0_10px_hsl(var(--ring)/0.5)]"
        />
        <Handle
          type="source"
          position={Position.Right}
          id="east"
          className="!bg-sky-500 !w-3 !h-3 border-2 border-background"
        />
        {(data.publishedEvents ?? []).slice(0, 5).map((evt, i) => (
          <Handle
            key={evt.id}
            type="source"
            position={Position.Right}
            id={evt.id}
            style={{
              top: getSlottedOffsets((data.publishedEvents ?? []).length)[i],
            }}
            className="!bg-amber-500 !w-2.5 !h-2.5 !border !border-background !rounded-sm"
            title={`Publishes: ${evt.label}`}
          />
        ))}
        {(data.subscribedEvents ?? []).slice(0, 5).map((evt, i) => (
          <Handle
            key={evt.id}
            type="target"
            position={Position.Left}
            id={evt.id}
            style={{
              top: getSlottedOffsets((data.subscribedEvents ?? []).length)[i],
            }}
            className="!bg-violet-500 !w-2.5 !h-2.5 !border !border-background !rounded-sm"
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
