import type {
  HexagonEdge,
  HexagonNodeWithLayout,
} from "../../../domain/index.js";

/**
 * The renderer-owned half of a hexagonal map (HEX-030).
 *
 * The domain describes a graph. This file describes how one particular family
 * of renderers — React Flow over CSS — is asked to draw it. The two used to be
 * one interface in `domain/model/hexagon-node`, which is a layering violation
 * this repo's arch linter structurally cannot see: it inspects *import edges*,
 * and a `style?: { zIndex?: number }` member introduces no import at all.
 *
 * The rule used to decide the split, applied field by field: **a field is
 * presentation iff its name or its value vocabulary is owned by the renderer** —
 * i.e. it could not be carried across a swap away from React Flow / CSS / SVG
 * without being translated, because it means nothing outside that renderer.
 *
 *  - `extent: "parent"` — React Flow's prop name and its literal value.
 *  - `style` — a CSS box (`width` / `height` / `zIndex`).
 *  - `variant` — Tailwind class strings and `#rrggbb` / `hsl()` literals.
 *  - `type` (edge) — `smoothstep` / `bezier` / `step` / `straight` are React
 *    Flow edge-path ids, not relationship kinds.
 *  - `animated` (edge) — a renderer animation flag.
 *
 * Everything the rule leaves alone stayed in the domain; see the comments on
 * `HexagonNodeWithLayout` and `HexagonEdge` for the per-field reasoning there.
 *
 * Nothing in this file is imported by `src/domain/`. The dependency runs
 * application → domain, which is the direction the layer rules allow.
 */

/**
 * CSS colour tokens for one node. Previously exported from `domain/`; the name
 * is kept so `@hexagen/visualization`'s public barrel is unchanged for callers
 * — only the layer it is declared in has moved.
 */
export interface NodeVisualProps {
  readonly headerBg: string;
  readonly bodyBg: string;
  readonly border: string;
  readonly handleColor: string;
  readonly headerText: string;
  readonly hexColor: string;
  readonly structuralHandleColor?: string;
  readonly publishedEventHandleColor?: string;
  readonly subscribedEventHandleColor?: string;
}

/**
 * React Flow / CSS instructions attached to a node on its way to a canvas.
 *
 * `draggable` is NOT here. It was on the domain node and no renderer ever read
 * it — `useCanvasConfig.toFlowNode` computes React Flow's `draggable` from the
 * node id and type instead. Relocating a field nothing consumes would have made
 * the projection look richer than it is, so it was deleted.
 */
export interface HexagonNodePresentation {
  extent?: "parent";
  variant?: NodeVisualProps;
  style?: { width?: number; height?: number; zIndex?: number };
}

/** React Flow edge-path renderer ids. Not relationship kinds. */
export type EdgeType =
  | "default"
  | "animated"
  | "smoothstep"
  | "step"
  | "straight"
  | "bezier";

/** React Flow instructions attached to an edge on its way to a canvas. */
export interface HexagonEdgePresentation {
  type?: EdgeType;
  animated?: boolean;
}

/** A node as a canvas adapter receives it: graph facts plus draw instructions. */
export type RenderableHexagonNode = HexagonNodeWithLayout &
  HexagonNodePresentation;

/** An edge as a canvas adapter receives it: graph facts plus draw instructions. */
export type RenderableHexagonEdge = HexagonEdge & HexagonEdgePresentation;

/**
 * Compile-time witness that the split is real.
 *
 * A test asserting "the domain node has no `style`" lives in a file anyone can
 * delete, and would in any case only ever check the names it was written with.
 * This states the invariant structurally, in production code: the domain half
 * and the presentation half must share no key. Re-adding `style` (or `extent`,
 * or `variant`) to `HexagonNodeWithLayout` makes the type below a tuple rather
 * than `true`, and the assignment on the next line stops compiling with the
 * offending key named in the error.
 *
 * It is intentionally not a `satisfies` or an `as` — either would let the
 * mismatch through by widening.
 */
type NodePresentationLeakedIntoDomain = Extract<
  keyof HexagonNodeWithLayout,
  keyof HexagonNodePresentation
>;
type EdgePresentationLeakedIntoDomain = Extract<
  keyof HexagonEdge,
  keyof HexagonEdgePresentation
>;

export type DomainGraphCarriesNoPresentation = [
  NodePresentationLeakedIntoDomain | EdgePresentationLeakedIntoDomain,
] extends [never]
  ? true
  : [
      "HEX-030: presentation keys are declared on a domain type",
      NodePresentationLeakedIntoDomain | EdgePresentationLeakedIntoDomain,
    ];

export const DOMAIN_GRAPH_CARRIES_NO_PRESENTATION: DomainGraphCarriesNoPresentation = true;
