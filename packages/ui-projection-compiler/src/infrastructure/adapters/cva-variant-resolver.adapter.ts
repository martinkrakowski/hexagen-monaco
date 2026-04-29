import type {
  VisualVariant,
  VisualVariantCategory,
} from "../../domain/value-objects/visual-variant.js";
import type { ResolveVariantPort } from "../../application/ports/in/resolve-variant.port.js";

/**
 * CvaVariantResolverAdapter — resolves a VisualVariantCategory to a VisualVariant
 * using a CVA-style (class-variance-authority) lookup table.
 *
 * Palette ported from legacy PORT_CATEGORY_COLORS / SATELLITE_NODE_STYLES.
 * No React, no xyflow — pure data mapping.
 */
export class CvaVariantResolverAdapter implements ResolveVariantPort {
  private static readonly PALETTE: Record<
    VisualVariantCategory,
    VisualVariant
  > = {
    driving: {
      category: "driving",
      headerBg: "bg-blue-600",
      bodyBg: "bg-card",
      border: "border-blue-500/30",
      handleColor: "!bg-blue-500",
      headerText: "text-white",
      hexColor: "#3b82f6",
    },
    driven: {
      category: "driven",
      headerBg: "bg-orange-600",
      bodyBg: "bg-card",
      border: "border-orange-500/30",
      handleColor: "!bg-orange-500",
      headerText: "text-white",
      hexColor: "#f97316",
    },
    presentation: {
      category: "presentation",
      headerBg: "bg-rose-600",
      bodyBg: "bg-card",
      border: "border-rose-500/30",
      handleColor: "!bg-rose-500",
      headerText: "text-white",
      hexColor: "#f43f5e",
    },
    infrastructure: {
      category: "infrastructure",
      headerBg: "bg-teal-600",
      bodyBg: "bg-card",
      border: "border-teal-500/30",
      handleColor: "!bg-teal-500",
      headerText: "text-white",
      hexColor: "#14b8a6",
    },
    entity: {
      category: "entity",
      headerBg: "bg-emerald-600",
      bodyBg: "bg-card",
      border: "border-emerald-500/30",
      handleColor: "!bg-emerald-500",
      headerText: "text-white",
      hexColor: "#10b981",
    },
    "value-object": {
      category: "value-object",
      headerBg: "bg-emerald-600",
      bodyBg: "bg-card",
      border: "border-emerald-500/30",
      handleColor: "!bg-emerald-500",
      headerText: "text-white",
      hexColor: "#10b981",
    },
    port: {
      category: "port",
      headerBg: "bg-violet-600",
      bodyBg: "bg-card",
      border: "border-violet-500/30",
      handleColor: "!bg-violet-500",
      headerText: "text-white",
      hexColor: "#8b5cf6",
    },
    "use-case": {
      category: "use-case",
      headerBg: "bg-amber-600",
      bodyBg: "bg-card",
      border: "border-amber-500/30",
      handleColor: "!bg-amber-500",
      headerText: "text-white",
      hexColor: "#f59e0b",
    },
    adapter: {
      category: "adapter",
      headerBg: "bg-sky-600",
      bodyBg: "bg-card",
      border: "border-sky-500/30",
      handleColor: "!bg-sky-500",
      headerText: "text-white",
      hexColor: "#0ea5e9",
    },
    "domain-event": {
      category: "domain-event",
      headerBg: "bg-violet-600",
      bodyBg: "bg-card",
      border: "border-violet-500/30",
      handleColor: "!bg-violet-500",
      headerText: "text-white",
      hexColor: "#8b5cf6",
    },
    policy: {
      category: "policy",
      headerBg: "bg-amber-600",
      bodyBg: "bg-card",
      border: "border-amber-500/30",
      handleColor: "!bg-amber-500",
      headerText: "text-white",
      hexColor: "#f59e0b",
    },
    aggregate: {
      category: "aggregate",
      headerBg: "bg-amber-600",
      bodyBg: "bg-card",
      border: "border-amber-500/30",
      handleColor: "!bg-amber-500",
      headerText: "text-white",
      hexColor: "#f59e0b",
    },
    service: {
      category: "service",
      headerBg: "bg-sky-600",
      bodyBg: "bg-card",
      border: "border-sky-500/30",
      handleColor: "!bg-sky-500",
      headerText: "text-white",
      hexColor: "#0ea5e9",
    },
    // Hexagonal Architecture 4-quadrant palette. Primary (driving, N/W) uses
    // warm/cool pairings; Secondary (driven, S/E) uses orange/teal pairings so
    // the compass role is visually encoded. Adapter = saturated; Port = muted.
    "primary-adapter": {
      category: "primary-adapter",
      headerBg: "bg-blue-600",
      bodyBg: "bg-card",
      border: "border-blue-500/30",
      handleColor: "!bg-blue-500",
      headerText: "text-white",
      hexColor: "#3b82f6",
    },
    "primary-port": {
      category: "primary-port",
      headerBg: "bg-violet-600",
      bodyBg: "bg-card",
      border: "border-violet-500/30",
      handleColor: "!bg-violet-500",
      headerText: "text-white",
      hexColor: "#8b5cf6",
    },
    "secondary-adapter": {
      category: "secondary-adapter",
      headerBg: "bg-teal-600",
      bodyBg: "bg-card",
      border: "border-teal-500/30",
      handleColor: "!bg-teal-500",
      headerText: "text-white",
      hexColor: "#14b8a6",
    },
    "secondary-port": {
      category: "secondary-port",
      headerBg: "bg-orange-600",
      bodyBg: "bg-card",
      border: "border-orange-500/30",
      handleColor: "!bg-orange-500",
      headerText: "text-white",
      hexColor: "#f97316",
    },
    default: {
      category: "default",
      headerBg: "bg-muted",
      bodyBg: "bg-card",
      border: "border-border",
      handleColor: "!bg-muted-foreground",
      headerText: "text-foreground",
      hexColor: "#71717a",
      structuralHandleColor: "!bg-sky-500",
      publishedEventHandleColor: "!bg-amber-500",
      subscribedEventHandleColor: "!bg-violet-500",
    },
  };

  resolve(category: VisualVariantCategory): VisualVariant {
    return CvaVariantResolverAdapter.PALETTE[category];
  }
}
