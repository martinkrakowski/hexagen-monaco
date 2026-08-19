import type { HexagonalMapInput } from "../../../application/ports/out/hexagonal-map-input.js";
import type {
  RenderableHexagonEdge,
  RenderableHexagonNode,
} from "../../../application/ports/out/renderable-graph.js";

import { LAYOUT_CONFIG } from "./config.js";
import { generateBoundedContextNodes } from "./generate-bounded-context-nodes.js";
import { generateExternalPeers } from "./generate-external-peers.js";
import { generatePeerMappingEdges } from "./generate-peer-mapping-edges.js";

export function generateHexagonalContextMap(map: HexagonalMapInput): {
  nodes: RenderableHexagonNode[];
  edges: RenderableHexagonEdge[];
} {
  const nodes: RenderableHexagonNode[] = [];
  const edges: RenderableHexagonEdge[] = [];

  const boundedContexts = map.contexts;
  const externalContexts = map.peers;
  const peerMappings = map.peerMappings;

  const contextCount = boundedContexts.length;
  const canvasCenterY = LAYOUT_CONFIG.CENTER_Y;
  const groupWidth = Math.max(
    LAYOUT_CONFIG.GROUP_MIN_WIDTH,
    contextCount * LAYOUT_CONFIG.GROUP_SPACING + 400,
  );

  // Removed monorepo-boundary container to let bounded contexts float freely
  // This allows ELK to position them dynamically without fighting static offsets
  // Set groupX and groupY to 0 since there's no container offset
  const groupX = 0;
  const groupY = 0;

  for (let i = 0; i < contextCount; i++) {
    const result = generateBoundedContextNodes({
      ctx: boundedContexts[i],
      index: i,
      contextCount,
      groupX,
      groupY,
      groupWidth,
    });
    nodes.push(...result.nodes);
    edges.push(...result.edges);
  }

  const peerResult = generateExternalPeers({
    externalContexts,
    boundedContexts,
    groupX,
    groupWidth,
    canvasCenterY,
  });
  nodes.push(...peerResult.nodes);
  edges.push(...peerResult.edges);

  const mappingEdges = generatePeerMappingEdges({
    peerMappings,
    boundedContexts,
    existingNodes: nodes,
  });
  edges.push(...mappingEdges);

  return { nodes, edges };
}
