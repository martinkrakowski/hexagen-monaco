import { Package, Gem, Zap, Settings2 } from "lucide-react";
import type { NodeStats } from "../types";

type CompassCountKey = "aggregates" | "valueObjects" | "events" | "services";
type CompassItemsKey =
  | "aggregateItems"
  | "valueObjectItems"
  | "eventItems"
  | "serviceItems";

/**
 * Get count for a specific stat key, safe fallback to 0
 */
export function getStatCount(
  stats: NodeStats | undefined,
  key: CompassCountKey,
): number {
  return stats?.[key] ?? 0;
}

/**
 * Get items array for a specific stat key, safe fallback to []
 */
export function getStatItems(
  stats: NodeStats | undefined,
  key: CompassItemsKey,
): string[] {
  return stats?.[key] ?? [];
}

/**
 * Calculate Y offsets for slotted event handles (max 5)
 */
export function getSlottedOffsets(count: number): string[] {
  const safeCount = Math.min(count, 5);
  const startY = 50 - ((safeCount - 1) * 7.5) / 2;
  return Array.from({ length: safeCount }, (_, i) => `${startY + i * 7.5}%`);
}

/**
 * Domain compass configuration (4-quadrant layout)
 */
export const DOMAIN_COMPASS = [
  {
    key: "aggregates" as const,
    itemsKey: "aggregateItems" as const,
    label: "Aggregates",
    Icon: Package,
    color: "text-amber-500",
  },
  {
    key: "valueObjects" as const,
    itemsKey: "valueObjectItems" as const,
    label: "Value Objects",
    Icon: Gem,
    color: "text-success",
  },
  {
    key: "events" as const,
    itemsKey: "eventItems" as const,
    label: "Events",
    Icon: Zap,
    color: "text-info",
  },
  {
    key: "services" as const,
    itemsKey: "serviceItems" as const,
    label: "Services",
    Icon: Settings2,
    color: "text-info",
  },
] as const;
