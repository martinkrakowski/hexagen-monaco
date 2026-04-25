import type { BoundedContext, ExternalContext } from "@hexagen/shared";
import type {
  HexagonEdge,
  HexagonNodeType,
  HexagonNodeWithLayout,
} from "../../../domain/index.js";

import { LAYOUT_CONFIG } from "./config.js";

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
    const isSK = bc.relationshipType === "SK";
    edges.push({
      id: `edge-peer-${bc.id}`,
      source: isUpstream ? bc.id : rootContextId,
      target: isUpstream ? rootContextId : bc.id,
      label: `${bc.relationshipType} ${bc.name}`,
      type: "smoothstep",
      animated: true,
      isSharedKernel: isSK || undefined,
    });
  });

  return { nodes, edges };
}
