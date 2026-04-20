import type { WizardData } from "@hexagen/shared";
import type { HexagonEdge, HexagonNodeType } from "@hexagen/visualization";

import { LAYOUT_CONFIG } from "./layout-engine/config";
import { generateBoundedContextNodes } from "./layout-engine/generate-bounded-context-nodes";
import { generateExternalPeers } from "./layout-engine/generate-external-peers";
import { generatePeerMappingEdges } from "./layout-engine/generate-peer-mapping-edges";
import type { HexagonNodeWithLayout } from "./layout-engine/types";

export type { HexagonNodeWithLayout };

/**
 * Orchestrates a hexagonal context-map render from wizard data.
 *
 * The output is a flat list of nodes + edges consumed by ReactFlow.
 * Four phases in order:
 *   1. Monorepo-boundary group node (the outer rectangle)
 *   2. Per-bounded-context hexagons + their satellites, adapters,
 *      and ports (in generate-bounded-context-nodes.ts)
 *   3. External-peer nodes outside the group + relationship edges
 *      (in generate-external-peers.ts)
 *   4. Cross-context peer-mapping edges, which require phase 2's
 *      nodes to already exist (in generate-peer-mapping-edges.ts)
 */
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

  // Phase 1: monorepo boundary group
  nodes.push({
    id: "monorepo-boundary",
    type: "group" as HexagonNodeType,
    label: "MONOREPO BOUNDARY",
    position: { x: groupX, y: groupY },
    style: { width: groupWidth, height: groupHeight },
  });

  // Phase 2: bounded context hexagons + all their satellites
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

  // Phase 3: external peers outside the group
  const peerResult = generateExternalPeers({
    externalContexts,
    boundedContexts,
    groupX,
    groupWidth,
    canvasCenterY,
  });
  nodes.push(...peerResult.nodes);
  edges.push(...peerResult.edges);

  // Phase 4: cross-context peer-mapping edges (must run after Phase 2
  // so the referenced context nodes exist in `nodes`)
  const mappingEdges = generatePeerMappingEdges({
    peerMappings,
    boundedContexts,
    existingNodes: nodes,
  });
  edges.push(...mappingEdges);

  return { nodes, edges };
}
