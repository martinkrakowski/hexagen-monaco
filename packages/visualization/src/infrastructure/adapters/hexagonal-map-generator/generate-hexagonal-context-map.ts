import type { WizardData } from "@hexagen/project-configuration";
import type {
  HexagonEdge,
  HexagonNodeWithLayout,
} from "../../../domain/index.js";

import { LAYOUT_CONFIG } from "./config.js";
import { generateBoundedContextNodes } from "./generate-bounded-context-nodes.js";
import { generateExternalPeers } from "./generate-external-peers.js";
import { generatePeerMappingEdges } from "./generate-peer-mapping-edges.js";

export function generateHexagonalContextMap(wizardData: WizardData): {
  nodes: HexagonNodeWithLayout[];
  edges: HexagonEdge[];
} {
  const nodes: HexagonNodeWithLayout[] = [];
  const edges: HexagonEdge[] = [];

  const boundedContexts = wizardData.boundedContexts ?? [];
  const externalContexts = wizardData.externalContexts ?? [];
  const peerMappings = wizardData.peerMappings ?? [];

  const contextCount = boundedContexts.length;
  const canvasCenterX = LAYOUT_CONFIG.CENTER_X;
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
