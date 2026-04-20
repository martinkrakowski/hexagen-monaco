import type { BoundedContext, ExternalContext } from "@hexagen/shared";
import type { HexagonEdge, HexagonNodeType } from "@hexagen/visualization";

import { LAYOUT_CONFIG } from "./config";
import type { HexagonNodeWithLayout } from "./types";

interface GenerateExternalPeersOptions {
  externalContexts: ExternalContext[];
  boundedContexts: BoundedContext[];
  groupX: number;
  groupWidth: number;
  canvasCenterY: number;
}

interface ExternalPeersOutput {
  nodes: HexagonNodeWithLayout[];
  edges: HexagonEdge[];
}

/**
 * External peers are bounded contexts not owned by the current
 * monorepo — they're visualized outside the monorepo-boundary group.
 *
 * Upstream peers (U / OHS relationships) render to the LEFT of the
 * group; downstream peers render to the RIGHT. An edge is drawn
 * between each peer and the root bounded context with a label
 * showing the relationship type.
 */
export function generateExternalPeers({
  externalContexts,
  boundedContexts,
  groupX,
  groupWidth,
  canvasCenterY,
}: GenerateExternalPeersOptions): ExternalPeersOutput {
  const nodes: HexagonNodeWithLayout[] = [];
  const edges: HexagonEdge[] = [];

  externalContexts.forEach((bc: ExternalContext, index: number) => {
    const isUpstream =
      bc.relationshipType === "U" || bc.relationshipType === "OHS";
    const peerOffsetX = isUpstream
      ? LAYOUT_CONFIG.PEER_OFFSET_LEFT
      : groupWidth + LAYOUT_CONFIG.PEER_OFFSET_RIGHT;
    const tx = groupX + peerOffsetX;
    const ty = canvasCenterY + index * LAYOUT_CONFIG.PEER_Y_STEP - 150;

    nodes.push({
      id: bc.id,
      type: "bounded-context" as HexagonNodeType,
      label: bc.name,
      position: { x: tx, y: ty },
      isPeer: true,
      stats: {
        aggregates: bc.entityNames?.length ?? 0,
        aggregateItems: bc.entityNames ?? [],
        valueObjects: 0,
        valueObjectItems: [],
        events: 0,
        eventItems: [],
        services: bc.useCaseNames?.length ?? 0,
        serviceItems: bc.useCaseNames ?? [],
      },
    });

    const rootContextId = boundedContexts[0]?.id || "context-0";
    edges.push({
      id: `edge-peer-${bc.id}`,
      source: isUpstream ? bc.id : rootContextId,
      target: isUpstream ? rootContextId : bc.id,
      label: `${bc.relationshipType} ${bc.name}`,
      type: "smoothstep",
      animated: true,
    });
  });

  return { nodes, edges };
}
