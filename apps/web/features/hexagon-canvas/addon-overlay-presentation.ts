import type { CSSProperties } from "react";
import { TEMPLATE_MANIFESTS } from "@/generated/template-manifest.generated";
import type { AddOnNodeMeta } from "./addon-overlay-nodes";

/**
 * Presentation layer for the add-on overlay — the SINGLE source of the labels,
 * hover text, and visual styles. The compass annotation ({@link PortAdapterCard}),
 * the strip chips ({@link AddOnChipNode}) and the legend ({@link AddOnLegend}) all
 * import from here, so the legend can never drift from the rendered nodes.
 */

/** Human-readable label per capability (for hover attribution). */
export const CAPABILITY_LABEL: Record<string, string> = {
  "messaging.out-adapter": "messaging adapter",
  "persistence.out-adapter": "persistence adapter",
  "external-integration.out-adapter": "external integration",
  "llm.out-adapter": "LLM adapter",
  "agent.out-adapter": "agent orchestration adapter",
  "kernel.user-context": "shared user context",
  "platform.container": "container",
  "platform.auth": "auth",
  "platform.error-handling": "error handling",
  "platform.lint": "lint / format",
  "platform.runtime": "runtime platform",
  "platform.mcp": "MCP server",
  "platform.observability": "observability",
  "platform.rate-limiting": "rate limiting",
  "platform.design-system": "design system",
  "platform.ci": "CI/CD pipeline",
};

/** The add-on's display name from the bundle (e.g. "BullMQ"), id as fallback. */
export function addOnName(addOnId: string): string {
  return TEMPLATE_MANIFESTS[addOnId]?.name ?? addOnId;
}

export function capabilityLabel(capability: string): string {
  return CAPABILITY_LABEL[capability] ?? capability;
}

/** One-line hover attribution, distinct per kind/reason (AC-1). */
export function addOnHoverText(addOn: AddOnNodeMeta): string {
  const name = addOnName(addOn.addOnId);
  const cap = capabilityLabel(addOn.capability);
  if (addOn.kind === "context-adapter") return `Provided by ${name} (${cap})`;
  if (addOn.kind === "shared-kernel") {
    return `Provided by ${name} — shared-kernel primitive`;
  }
  switch (addOn.reason) {
    case "no-host":
      return `${name} selected — no context declares this ${cap} yet`;
    case "no-compass-field":
      return `Provided by ${name} — no dedicated compass slot (${cap})`;
    default:
      // Surface the human-readable capability (from CAPABILITY_LABEL), so a
      // project chip reads e.g. "Provided by Clerk — auth · project-level" —
      // the role, not just the vendor name.
      return `Provided by ${name} — ${cap} · project-level`;
  }
}

/**
 * The dashed accent ring for an add-on-provided compass adapter — a CSS variable,
 * never a hardcoded colour. Shared by the node and the legend.
 */
export const ADDON_RING_STYLE: CSSProperties = {
  outline: "2px dashed hsl(var(--addon-accent))",
  outlineOffset: "2px",
};

/**
 * Visual treatment for a strip chip, keyed off kind/reason — solid accent
 * (platform), violet (shared-kernel), or muted+dashed (no declared host). Shared
 * by the chip node and the legend so they cannot drift.
 */
export function addOnChipVisual(
  addOn: Pick<AddOnNodeMeta, "kind" | "reason">,
): {
  className: string;
  style: CSSProperties;
} {
  if (addOn.kind === "shared-kernel") {
    return {
      className: "border text-foreground",
      style: {
        borderColor: "hsl(var(--shared-kernel-edge))",
        background: "hsl(var(--shared-kernel-edge) / 0.12)",
      },
    };
  }
  if (addOn.reason === "no-host") {
    return {
      className: "border border-dashed text-muted-foreground",
      style: {
        borderColor: "hsl(var(--muted-foreground) / 0.6)",
        background: "hsl(var(--muted) / 0.4)",
      },
    };
  }
  return {
    className: "border text-foreground",
    style: {
      borderColor: "hsl(var(--addon-accent))",
      background: "hsl(var(--addon-accent) / 0.12)",
    },
  };
}
