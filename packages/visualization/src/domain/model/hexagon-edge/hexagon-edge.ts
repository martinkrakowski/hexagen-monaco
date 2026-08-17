/**
 * A relationship between two nodes.
 *
 * What is deliberately NOT here (HEX-030 applied to the edge). This type used
 * to carry `type?: EdgeType` (whose members — `smoothstep`, `bezier`, `step`,
 * `straight` — are React Flow edge-path renderer ids), `animated`, `markerEnd`
 * (an SVG functional IRI, `"url(#arrow)"`), `style` (a CSS declaration bag) and
 * `className`. The finding's evidence quoted only the node, but `className` on
 * this interface is the same defect one file over, so it is fixed here too
 * rather than left as the one exception a domain-purity guard would have to
 * carve out.
 *
 * `markerEnd`, `style` and `className` were also *dead*: the only edge renderer
 * in the repo (`apps/web/features/hexagon-canvas/hooks/useCanvasConfig.ts`)
 * builds its own marker and stroke and never reads them. They are deleted, not
 * relocated. `type` and `animated` are live and moved to `HexagonEdgePresentation`.
 *
 * `sourceHandle` / `targetHandle` stay. Their *names* come from React Flow, but
 * their *values* are this repo's vocabulary — the compass directions and the
 * `pub_` / `sub_` domain-event prefixes that `useCanvasValidation` applies a
 * connection rule to. That rule is graph semantics, so the anchors are domain.
 */
export interface HexagonEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  sourceHandle?: string;
  targetHandle?: string;
  isSharedKernel?: boolean;
}

export function createHexagonEdge(
  id: string,
  source: string,
  target: string,
  label?: string,
): HexagonEdge {
  return {
    id,
    source,
    target,
    label,
  };
}
