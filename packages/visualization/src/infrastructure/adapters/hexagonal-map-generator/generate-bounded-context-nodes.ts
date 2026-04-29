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
    position: { x: hexX, y: hexY },
    isRoot: isRootContext,
    draggable: true,
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
    // Entities are rendered as root-level draggable cards below the bounded
    // context (south of the south-adapter stack), stacked vertically under
    // the Domain column inside the hex. They are NOT React-Flow children of
    // Domain: Domain is rendered as a 140x28 label, which would force
    // `extent: 'parent'` children to clamp to (0,0) and visually stack on top
    // of each other. Positions are absolute (hexX/hexY offsets).
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
    // Use cases are rendered as root-level draggable cards below the bounded
    // context (south of the south-adapter stack), stacked vertically under
    // the Use Cases column inside the hex. Same rationale as entities above.
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
    // Hexagonal architecture: one handle per compass side. When multiple
    // adapters live on the same side, they stack vertically outside the hex
    // (same x as the handle, y offset per index) and all edges converge on
    // the single `north` / `south` handle. This mirrors how inbound/outbound
    // ports stack outside the west/east handles below.
    const yOffset =
      adapter.side === "north"
        ? hexY -
          LAYOUT_CONFIG.NORTH_OFFSET_BASE -
          adapter.handleIndex * LAYOUT_CONFIG.NORTH_OFFSET_STEP
        : hexY +
          LAYOUT_CONFIG.SOUTH_OFFSET_BASE +
          LAYOUT_CONFIG.SOUTH_OFFSET_ADDITIONAL +
          adapter.handleIndex * LAYOUT_CONFIG.SOUTH_OFFSET_STEP;

    // Center adapter horizontally on the hex's compass handle (both north
    // and south handles sit at 50% of the hex width by default).
    const adapterX =
      hexX + hexDimension / 2 - LAYOUT_CONFIG.ADAPTER_NODE_WIDTH / 2;

    nodes.push({
      id: adapter.id,
      type: "adapter" as HexagonNodeType,
      label: adapter.label,
      position: { x: adapterX, y: yOffset },
      side: adapter.side,
      // Compass role in hexagonal architecture:
      //   north = driving adapter (Controller / UI / CLI / Event Subscriber)
      //   south = driven adapter (DB client / API client / Message Producer)
      // The category hint flows through MapNodeVisualUseCase to set both the
      // rendered label text ("PRIMARY ADAPTER" / "SECONDARY ADAPTER") and
      // the visual variant palette.
      category:
        adapter.side === "north" ? "primary-adapter" : "secondary-adapter",
      // NOTE: Adapters are independent nodes positioned via compass positioning.
      // They are NOT children of the bounded context (no parentId).
      // This allows them to be positioned outside the bounded context visually.
      // The 'side' property is used by useElkLayout for compass positioning.
    });

    const edgeConfig =
      adapter.side === "north"
        ? {
            source: adapter.id,
            target: contextId,
            targetHandle: "north",
          }
        : {
            source: contextId,
            target: adapter.id,
            sourceHandle: "south",
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
      type: "adapter" as HexagonNodeType,
      label: port,
      side: "west",
      // West compass = primary / driving side -> primary adapter
      category: "primary-adapter",
      // Using zIndex to make inbound adapters more visible
      style: { width: 180, zIndex: 20 },
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
      type: "adapter" as HexagonNodeType,
      label: port,
      side: "east",
      // East compass = secondary / driven side -> secondary adapter
      category: "secondary-adapter",
      // Using zIndex to make outbound adapters more visible
      style: { width: 180, zIndex: 20 },
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
