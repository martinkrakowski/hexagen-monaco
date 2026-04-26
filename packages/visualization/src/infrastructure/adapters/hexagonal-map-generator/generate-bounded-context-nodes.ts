import type { BoundedContext } from "@hexagen/project-configuration";
import type {
   HexagonEdge,
   HexagonNodeType,
   HexagonNodeWithLayout,
 } from "../../../domain/index.js";

import { LAYOUT_CONFIG, staggerYFor } from "./config.js";

interface GenerateBoundedContextNodesOptions {
  ctx: BoundedContext;
  index: number;
  contextCount: number;
  groupX: number;
  groupY: number;
  groupWidth: number;
}

interface BoundedContextOutput {
  nodes: HexagonNodeWithLayout[];
  edges: HexagonEdge[];
}

export function generateBoundedContextNodes({
  ctx,
  index,
  contextCount,
  groupX,
  groupY,
  groupWidth,
}: GenerateBoundedContextNodesOptions): BoundedContextOutput {
  const nodes: HexagonNodeWithLayout[] = [];
  const edges: HexagonEdge[] = [];

  const entityItems = ctx.coreDomainEntities ?? ctx.entities ?? [];
  const useCaseItems = ctx.useCases ?? [];
  const valueObjectItems = ctx.valueObjects ?? [];
  const eventItems = ctx.domainEvents ?? [];

  const yStagger = staggerYFor(index);
  const contextOffsetX =
    (index - (contextCount - 1) / 2) * LAYOUT_CONFIG.GROUP_SPACING;
  const groupCenterX = groupX + groupWidth / 2;
  const groupCenterY = groupY + LAYOUT_CONFIG.GROUP_HEIGHT / 2;

  const hexX =
    groupCenterX + contextOffsetX + LAYOUT_CONFIG.HEX_POSITION_OFFSET_X;
  const hexY = groupCenterY + LAYOUT_CONFIG.HEX_POSITION_OFFSET_Y + yStagger;

  const isRootContext = index === 0;
  const hexDimension = isRootContext
    ? LAYOUT_CONFIG.ROOT_HEX_DIMENSION
    : LAYOUT_CONFIG.SATELLITE_HEX_DIMENSION;

  const contextId = ctx.id || `context-${index}`;

  nodes.push({
    id: contextId,
    type: "bounded-context" as HexagonNodeType,
    label: ctx.name || `Context ${index + 1}`,
    position: { x: hexX - groupX, y: hexY - groupY },
    parentId: "monorepo-boundary",
    extent: "parent",
    isRoot: isRootContext,
    draggable: isRootContext,
    style: { width: hexDimension, height: hexDimension },
    stats: {
      aggregates: entityItems.length,
      aggregateItems: entityItems,
      valueObjects: valueObjectItems.length,
      valueObjectItems,
      events: eventItems.length,
      eventItems,
      services: useCaseItems.length,
      serviceItems: useCaseItems,
    },
  });

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
      ? LAYOUT_CONFIG.ENTITY_START_X
      : hexX + LAYOUT_CONFIG.SATELLITE_ENTITY_START_X;
    const posY = isRootContext
      ? LAYOUT_CONFIG.ENTITY_START_Y + i * LAYOUT_CONFIG.ENTITY_ROW_HEIGHT
      : hexY +
        LAYOUT_CONFIG.SATELLITE_ENTITY_START_Y +
        i * LAYOUT_CONFIG.ENTITY_ROW_HEIGHT;
    const entityId = `entity-${contextId}-${i}`;
    nodes.push({
      id: entityId,
      label: name,
      type: "entity" as HexagonNodeType,
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
      ? LAYOUT_CONFIG.USECASE_START_Y + i * LAYOUT_CONFIG.USECASE_ROW_HEIGHT
      : hexY +
        LAYOUT_CONFIG.SATELLITE_USECASE_START_Y +
        i * LAYOUT_CONFIG.USECASE_ROW_HEIGHT;
    const useCaseId = `usecase-${contextId}-${i}`;
    nodes.push({
      id: useCaseId,
      label: name,
      type: "use-case" as HexagonNodeType,
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

  const adapters: Array<{
    id: string;
    label: string;
    side: "north" | "south";
    handleIndex: number;
  }> = [];

  let northCount = 0;
  const apiLabel = ctx.infrastructureTarget
    ? ctx.infrastructureTarget.charAt(0).toUpperCase() +
      ctx.infrastructureTarget.slice(1)
    : ctx.apiFramework;
  if (apiLabel) {
    adapters.push({
      id: `adapter-${contextId}-${apiLabel}`,
      label: apiLabel,
      side: "north",
      handleIndex: northCount++,
    });
  }
  if (ctx.uiFramework) {
    adapters.push({
      id: `adapter-${contextId}-${ctx.uiFramework}`,
      label: ctx.uiFramework,
      side: "north",
      handleIndex: northCount++,
    });
  }

  let southCount = 0;
  for (const field of [
    ctx.messagingAdapter,
    ctx.persistenceAdapter,
    ctx.telemetryProvider,
  ] as const) {
    if (!field) continue;
    adapters.push({
      id: `adapter-${contextId}-${field}`,
      label: field,
      side: "south",
      handleIndex: southCount++,
    });
  }

  adapters.forEach((adapter) => {
    const yOffset =
      adapter.side === "north"
        ? hexY -
          LAYOUT_CONFIG.NORTH_OFFSET_BASE -
          adapter.handleIndex * LAYOUT_CONFIG.NORTH_OFFSET_STEP
        : hexY +
          LAYOUT_CONFIG.SOUTH_OFFSET_BASE +
          LAYOUT_CONFIG.SOUTH_OFFSET_ADDITIONAL +
          adapter.handleIndex * LAYOUT_CONFIG.SOUTH_OFFSET_STEP;

    const xOffset =
      adapter.side === "north"
        ? LAYOUT_CONFIG.NORTH_ADAPTER_X_OFFSET
        : LAYOUT_CONFIG.SOUTH_ADAPTER_X_OFFSET;

    nodes.push({
      id: adapter.id,
      type: "port" as HexagonNodeType,
      label: adapter.label,
      position: { x: hexX + xOffset, y: yOffset },
      side: adapter.side,
    });

    const edgeConfig =
      adapter.side === "north"
        ? {
            source: adapter.id,
            target: contextId,
            targetHandle: `north-${adapter.handleIndex}`,
          }
        : {
            source: contextId,
            target: adapter.id,
            sourceHandle: `south-${adapter.handleIndex}`,
            targetHandle: "south",
          };

    edges.push({
      id: `e-${adapter.id}`,
      source: edgeConfig.source,
      target: edgeConfig.target,
      sourceHandle: edgeConfig.sourceHandle,
      targetHandle: edgeConfig.targetHandle,
      type: "smoothstep",
    });
  });

  const inboundPorts = ctx.portConfiguration?.inboundPorts ?? [];
  const outboundPorts = ctx.portConfiguration?.outboundPorts ?? [];

  inboundPorts.forEach((port, i) => {
    const portId = `port-in-${contextId}-${port}-${i}`;
    const yOffset =
      hexY +
      LAYOUT_CONFIG.PORT_OFFSET_BASE_Y +
      i * LAYOUT_CONFIG.PORT_OFFSET_STEP_Y;

    nodes.push({
      id: portId,
      type: "port" as HexagonNodeType,
      label: port,
      side: "west",
      position: { x: hexX + LAYOUT_CONFIG.WEST_PORT_OFFSET_X, y: yOffset },
    });

    edges.push({
      id: `edge-${portId}`,
      source: portId,
      sourceHandle: "east",
      target: contextId,
      targetHandle: "west",
      type: "smoothstep",
    });
  });

  outboundPorts.forEach((port, i) => {
    const portId = `port-out-${contextId}-${port}-${i}`;
    const yOffset =
      hexY +
      LAYOUT_CONFIG.PORT_OFFSET_BASE_Y +
      i * LAYOUT_CONFIG.PORT_OFFSET_STEP_Y;

    nodes.push({
      id: portId,
      type: "port" as HexagonNodeType,
      label: port,
      side: "east",
      position: { x: hexX + LAYOUT_CONFIG.EAST_PORT_OFFSET_X, y: yOffset },
    });

    edges.push({
      id: `edge-${portId}`,
      source: contextId,
      sourceHandle: "east",
      target: portId,
      targetHandle: "west",
      type: "smoothstep",
    });
  });

  return { nodes, edges };
}
