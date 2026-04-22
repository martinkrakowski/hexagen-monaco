import type { WizardData } from "@hexagen/shared";
import type {
  HexagonEdge,
  HexagonNodeWithLayout,
} from "@hexagen/visualization";

import { LAYOUT_CONFIG } from "./config";
import { generateBoundedContextNodes } from "./generate-bounded-context-nodes";
import { generateExternalPeers } from "./generate-external-peers";
import { generatePeerMappingEdges } from "./generate-peer-mapping-edges";

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
  const groupHeight = LAYOUT_CONFIG.GROUP_HEIGHT;
  const groupX = canvasCenterX - groupWidth / 2;
  const groupY = canvasCenterY - groupHeight / 2;

  nodes.push({
    id: "monorepo-boundary",
    type: "group",
    label: "MONOREPO BOUNDARY",
    position: { x: groupX, y: groupY },
    style: { width: groupWidth, height: groupHeight },
  });

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
