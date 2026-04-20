import type { BoundedContext } from "@hexagen/shared";
import type { HexagonEdge, HexagonNodeType } from "@hexagen/visualization";

import { LAYOUT_CONFIG, staggerYFor } from "./config";
import { classifyAdapterLabel } from "./classify-adapter-label";
import type { HexagonNodeWithLayout } from "./types";

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

/**
 * Generates all visual elements for a single bounded context:
 *   1. Hexagon body (root or satellite sized) nested under the
 *      monorepo-boundary group
 *   2. Inner Domain + Use Cases labels
 *   3. Entity satellites + edges from Domain → each entity
 *   4. Use-case satellites + edges from Use Cases → each use case
 *   5. North/south adapters (API/UI on top; Messaging/Persistence/
 *      Telemetry on bottom) with category-tagged labels
 *   6. West/east port satellites (driving/inbound on the west,
 *      driven/outbound on the east) with edges to hex handles
 *
 * Positions for inner nodes use parentId + ReactFlow's `extent`
 * constraint; positions for outer satellites are absolute canvas
 * coordinates relative to this hexagon's center.
 *
 * The root hexagon (index 0) renders larger and is draggable;
 * satellites are smaller and pinned in place.
 */
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

  // --- Position calculation ---
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

  // --- 1. Hexagon body (nested under monorepo-boundary group) ---
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

  // --- 2. Inner Domain + Use Cases labels ---
  const domainNodeId = `domain-${contextId}`;
  nodes.push({
    id: domainNodeId,
    label: "Domain",
    type: "inner" as HexagonNodeType,
    category: "Domain",
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
    category: "Use Cases",
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

  // --- 3. Entity satellites (one column) ---
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
      category: "Entity",
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

  // --- 4. Use-case satellites (one column) ---
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
      category: "Use Case",
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

  // --- 5. North/South adapters ---
  const adapters: Array<{
    id: string;
    label: string;
    side: "north" | "south";
    handleIndex: number;
  }> = [];

  // North stack: API adapter (infrastructureTarget or legacy apiFramework), then UI
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

  // South stack: messaging, persistence, telemetry
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
      category: classifyAdapterLabel(adapter.label, adapter.side),
      position: { x: hexX + xOffset, y: yOffset },
      side: adapter.side,
    });

    // North: adapter → hex (adapter drives into hexagon).
    // South: hex → adapter (hexagon drives outbound to adapter).
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

  // --- 6. Port satellites (driving/driven) ---
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
