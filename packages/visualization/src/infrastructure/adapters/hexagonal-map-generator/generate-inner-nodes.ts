import type { BoundedContext } from "@hexagen/project-configuration";
import type {
  HexagonEdge,
  HexagonNodeType,
  HexagonNodeWithLayout,
} from "../../../domain/index.js";

import { LAYOUT_CONFIG } from "./config.js";

interface InnerNodesOutput {
  nodes: HexagonNodeWithLayout[];
  edges: HexagonEdge[];
  domainNodeId: string;
  useCasesNodeId: string;
}

function generateInnerNodes(
  ctx: BoundedContext,
  contextId: string,
  hexX: number,
  hexY: number,
  isRootContext: boolean,
): InnerNodesOutput {
  const nodes: HexagonNodeWithLayout[] = [];
  const edges: HexagonEdge[] = [];

  const entityItems = ctx.coreDomainEntities ?? ctx.entities ?? [];
  const useCaseItems = ctx.useCases ?? [];

  const domainNodeId = `domain-${contextId}`;
  nodes.push({
    id: domainNodeId,
    label: "Domain",
    type: "inner" as HexagonNodeType,
    parentId: contextId,
    extent: "parent",
    draggable: false,
    position: {
      x: isRootContext
        ? LAYOUT_CONFIG.DOMAIN_NODE_X
        : LAYOUT_CONFIG.SATELLITE_DOMAIN_X,
      y: isRootContext
        ? LAYOUT_CONFIG.DOMAIN_NODE_Y
        : LAYOUT_CONFIG.SATELLITE_DOMAIN_Y,
    },
  });

  const useCasesNodeId = `usecases-${contextId}`;
  nodes.push({
    id: useCasesNodeId,
    label: "Use Cases",
    type: "inner" as HexagonNodeType,
    parentId: contextId,
    extent: "parent",
    draggable: false,
    position: {
      x: isRootContext
        ? LAYOUT_CONFIG.USECASES_NODE_X
        : LAYOUT_CONFIG.SATELLITE_USECASES_X,
      y: isRootContext
        ? LAYOUT_CONFIG.USECASES_NODE_Y
        : LAYOUT_CONFIG.SATELLITE_USECASES_Y,
    },
  });

  entityItems.forEach((name: string, i: number) => {
    const posX = isRootContext
      ? hexX + LAYOUT_CONFIG.ENTITY_START_X
      : hexX + LAYOUT_CONFIG.SATELLITE_ENTITY_START_X;
    const posY = isRootContext
      ? hexY +
        LAYOUT_CONFIG.ENTITY_START_Y +
        i * LAYOUT_CONFIG.ENTITY_ROW_HEIGHT
      : hexY +
        LAYOUT_CONFIG.SATELLITE_ENTITY_START_Y +
        i * LAYOUT_CONFIG.ENTITY_ROW_HEIGHT;
    const entityId = `entity-${contextId}-${i}`;
    nodes.push({
      id: entityId,
      label: name,
      type: "entity" as HexagonNodeType,
      draggable: true,
      position: { x: posX, y: posY },
    });
    edges.push({
      id: `edge-${contextId}-entity-${i}`,
      source: domainNodeId,
      sourceHandle: "south",
      target: entityId,
      targetHandle: "north",
      type: "smoothstep",
      animated: true,
    });
  });

  useCaseItems.forEach((name: string, i: number) => {
    const posX = isRootContext
      ? hexX + LAYOUT_CONFIG.USECASE_X_OFFSET
      : hexX + LAYOUT_CONFIG.SATELLITE_USECASE_X_OFFSET;
    const posY = isRootContext
      ? hexY +
        LAYOUT_CONFIG.USECASE_START_Y +
        i * LAYOUT_CONFIG.USECASE_ROW_HEIGHT
      : hexY +
        LAYOUT_CONFIG.SATELLITE_USECASE_START_Y +
        i * LAYOUT_CONFIG.USECASE_ROW_HEIGHT;
    const useCaseId = `usecase-${contextId}-${i}`;
    nodes.push({
      id: useCaseId,
      label: name,
      type: "use-case" as HexagonNodeType,
      draggable: true,
      position: { x: posX, y: posY },
    });
    edges.push({
      id: `edge-${contextId}-usecase-${i}`,
      source: useCasesNodeId,
      sourceHandle: "south",
      target: useCaseId,
      targetHandle: "north",
      type: "smoothstep",
      animated: true,
    });
  });

  return { nodes, edges, domainNodeId, useCasesNodeId };
}

export { generateInnerNodes };
