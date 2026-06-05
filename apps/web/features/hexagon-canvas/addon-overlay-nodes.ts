/**
 * Add-on overlay → canvas nodes (web-only; the visualization package stays
 * add-on-agnostic). Turns the pure {@link computeAddOnOverlay} descriptors into
 * concrete canvas mutations:
 *   - context-adapter → annotate the EXISTING compass adapter node (AC-2: one
 *     node, never double-drawn), matched by its deterministic id (not position).
 *   - platform-zone / shared-kernel → a root-level chip in the "Platform add-ons"
 *     strip below the diagram (there is no shared-kernel context node to host).
 *
 * The strip chips are POSITIONED after layout ({@link placeStripChips}) from the
 * laid-out bounding box, so they always clear the lowest hexagon regardless of
 * context count, and align to the leftmost node.
 */
import type { BoundedContext } from "@hexagen/project-configuration";
import type { HexagonNode } from "@hexagen/visualization";
import {
  type AddOnOverlay,
  type CompassAdapterField,
  type OverlayContext,
} from "./addon-overlay";

/**
 * Web-only React Flow node type for strip chips. Deliberately NOT a member of
 * the visualization `HexagonNodeType` vocabulary — registered in the web
 * `nodeTypes` map (useCanvasConfig) so @hexagen/visualization never learns about
 * add-ons.
 */
export const ADDON_CHIP_TYPE = "addon-chip";

/** Web-only React Flow node type for the strip's "Platform add-ons" label. */
export const ADDON_STRIP_LABEL_TYPE = "addon-strip-label";

/** Provenance marker the renderer reads for AC-1 (distinct styling + hover). */
export interface AddOnNodeMeta {
  addOnId: string;
  capability: string;
  kind: "context-adapter" | "shared-kernel" | "platform-zone";
  /** platform-zone only — drives distinct hover attribution. */
  reason?: "project" | "no-host" | "no-compass-field";
}

/** An existing canvas node annotated with add-on provenance (web-local). */
export type WithAddOn<T> = T & { addOn?: AddOnNodeMeta };

/** A strip-chip node. `type` is the web-only {@link ADDON_CHIP_TYPE}. */
export interface AddOnChipNode {
  id: string;
  type: typeof ADDON_CHIP_TYPE;
  label: string;
  position: { x: number; y: number };
  addOn: AddOnNodeMeta;
}

/** The strip's section label node (no add-on payload). */
export interface AddOnStripLabelNode {
  id: string;
  type: typeof ADDON_STRIP_LABEL_TYPE;
  label: string;
  position: { x: number; y: number };
}

/** Any node the overlay appends below the diagram (chips + the strip label). */
export type AddOnOverlayNode = AddOnChipNode | AddOnStripLabelNode;

/** Map wizard bounded contexts to the join's structural view, mirroring the
 *  generator's `ctx.id || \`context-${i}\`` id derivation so annotation ids match. */
export function overlayContextsFrom(
  boundedContexts: readonly BoundedContext[],
): OverlayContext[] {
  return boundedContexts.map((c, i) => ({
    id: c.id || `context-${i}`,
    messagingAdapter: c.messagingAdapter,
    persistenceAdapter: c.persistenceAdapter,
  }));
}

/**
 * The deterministic compass adapter node id for a context+field, mirroring
 * generate-compass-nodes: a declared `messagingAdapter` is always south index 0;
 * a declared `persistenceAdapter` is always east index 0. Pinned by a test that
 * runs the real generator, so any id-scheme drift fails loudly.
 */
export function compassNodeIdFor(
  contextId: string,
  field: CompassAdapterField,
  value: string,
): string {
  return field === "messagingAdapter"
    ? `adapter-${contextId}-south-${value}-0`
    : `port-out-${contextId}-${value}-0`;
}

/**
 * Annotate existing compass adapter nodes for every context-adapter descriptor.
 * Mutates matched nodes in place (sets `.addOn`) and returns the array. Matching
 * is by node id (deterministic), never by array position — so it is stable
 * regardless of render/iteration order (AC-2).
 */
export function annotateCompassNodes(
  nodes: HexagonNode[],
  overlay: readonly AddOnOverlay[],
  contexts: readonly OverlayContext[],
): HexagonNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ctxById = new Map(contexts.map((c) => [c.id, c]));

  for (const o of overlay) {
    if (o.kind !== "context-adapter") continue;
    const value = ctxById.get(o.contextId)?.[o.field];
    if (!value) continue; // defensive: descriptor only exists when declared
    const target = byId.get(compassNodeIdFor(o.contextId, o.field, value));
    if (!target) continue;
    (target as WithAddOn<HexagonNode>).addOn = {
      addOnId: o.addOnId,
      capability: o.capability,
      kind: "context-adapter",
    };
  }
  return nodes;
}

/**
 * Build a strip chip for every non-context descriptor (platform-zone +
 * shared-kernel). Positions are placeholders — {@link placeStripChips} sets them
 * after layout.
 */
export function buildStripChips(
  overlay: readonly AddOnOverlay[],
): AddOnChipNode[] {
  const chips: AddOnChipNode[] = [];
  for (const o of overlay) {
    if (o.kind === "context-adapter") continue;
    chips.push({
      id: `addon-chip-${o.addOnId}`,
      type: ADDON_CHIP_TYPE,
      label: o.addOnId,
      position: { x: 0, y: 0 },
      addOn: {
        addOnId: o.addOnId,
        capability: o.capability,
        kind: o.kind,
        reason: o.kind === "platform-zone" ? o.reason : undefined,
      },
    });
  }
  return chips;
}

const STRIP = {
  CLEARANCE_Y: 140, // gap below the laid-out diagram's bottom
  LABEL_OFFSET_Y: 36, // gap above the first chip for the strip label
  CHIP_WIDTH: 200,
  CHIP_HEIGHT: 60,
  GAP_X: 20,
  GAP_Y: 16,
  PER_ROW: 6,
} as const;

/** Rough rendered height per node type, for the post-layout bounding box. */
function estimatedHeight(type: HexagonNode["type"]): number {
  if (type === "bounded-context") return 500;
  if (type === "group") return 600;
  if (type === "peer") return 220;
  return 120;
}

/**
 * Position strip chips AFTER layout: a left-aligned row (wrapping) placed below
 * the laid-out diagram. Reads the bounding box of `laidOutNodes` (leftmost x,
 * lowest bottom) so the strip never overlaps the contexts no matter how many
 * there are. Returns positioned copies; does not mutate the input.
 */
export function placeStripChips(
  laidOutNodes: readonly HexagonNode[],
  chips: readonly AddOnChipNode[],
): AddOnOverlayNode[] {
  if (chips.length === 0) return [];

  let minX = Infinity;
  let maxBottom = -Infinity;
  for (const n of laidOutNodes) {
    minX = Math.min(minX, n.position.x);
    maxBottom = Math.max(maxBottom, n.position.y + estimatedHeight(n.type));
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    maxBottom = 0;
  }

  const startX = minX;
  const startY = maxBottom + STRIP.CLEARANCE_Y;

  const placedChips: AddOnChipNode[] = chips.map((chip, i) => {
    const row = Math.floor(i / STRIP.PER_ROW);
    const col = i % STRIP.PER_ROW;
    return {
      ...chip,
      position: {
        x: startX + col * (STRIP.CHIP_WIDTH + STRIP.GAP_X),
        y: startY + row * (STRIP.CHIP_HEIGHT + STRIP.GAP_Y),
      },
    };
  });

  // "Platform add-ons" label, left-aligned just above the first chip.
  const label: AddOnStripLabelNode = {
    id: "addon-strip-label",
    type: ADDON_STRIP_LABEL_TYPE,
    label: "Platform add-ons",
    position: { x: startX, y: startY - STRIP.LABEL_OFFSET_Y },
  };

  return [label, ...placedChips];
}
