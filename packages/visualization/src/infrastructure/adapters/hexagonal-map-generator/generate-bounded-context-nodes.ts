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

  // ---------------------------------------------------------------------
  // Hexagonal compass mapping (wizard fields -> sides)
  //
  //   West  (Presentation          / Primary Adapter) <- uiFramework
  //   North (APIs                  / Primary Adapter) <- apiFramework /
  //                                                      infrastructureTarget +
  //                                                      inboundPorts (all)
  //   East  (State & Storage       / Secondary Port ) <- persistenceAdapter +
  //                                                      outboundPorts (DB-flavored)
  //   South (External Integrations / Secondary Port ) <- messagingAdapter +
  //                                                      telemetryProvider +
  //                                                      outboundPorts (3rd-party)
  //
  // Outbound ports split across two driven sides per the wizard's port
  // catalog classification (apps/web/.../port-catalog.ts). The mapping is
  // duplicated here (as a small inline set) to keep the visualization
  // package free of wizard-layer imports. Values must stay in sync with the
  // catalog's `compass` field. Unknown outbound port values fall through to
  // South (External Integrations) as a safe default.
  //
  // Per-card display labels use the underlying wizard value (e.g.
  // "React Router", "relational-db") while the compass perimeter text
  // ("PRESENTATION", "APIs", "STATE & STORAGE", "EXTERNAL INTEGRATIONS")
  // comes from the static hex component and provides the architectural
  // anchor.
  // ---------------------------------------------------------------------

  const apiLabel = ctx.infrastructureTarget
    ? ctx.infrastructureTarget.charAt(0).toUpperCase() +
      ctx.infrastructureTarget.slice(1)
    : ctx.apiFramework;

  // Outbound-port → compass classification. Must stay in sync with
  // apps/web/features/project-wizard/steps/port-configuration-step/port-catalog.ts
  const EAST_OUTBOUND_PORTS = new Set<string>(["relational-db", "document-db"]);
  const inboundPorts = ctx.portConfiguration?.inboundPorts ?? [];
  const outboundPorts = ctx.portConfiguration?.outboundPorts ?? [];

  const westItems: string[] = [];
  if (ctx.uiFramework) westItems.push(ctx.uiFramework);

  const northItems: string[] = [];
  if (apiLabel) northItems.push(apiLabel);
  northItems.push(...inboundPorts);

  const eastItems: string[] = [];
  if (ctx.persistenceAdapter) eastItems.push(ctx.persistenceAdapter);
  eastItems.push(
    ...outboundPorts.filter((port) => EAST_OUTBOUND_PORTS.has(port)),
  );

  const southItems: string[] = [];
  if (ctx.messagingAdapter) southItems.push(ctx.messagingAdapter);
  if (ctx.telemetryProvider) southItems.push(ctx.telemetryProvider);
  southItems.push(
    ...outboundPorts.filter((port) => !EAST_OUTBOUND_PORTS.has(port)),
  );

  // --- North: APIs (Primary Adapter) --------------------------------------
  northItems.forEach((item, i) => {
    const nodeId = `adapter-${contextId}-north-${item}-${i}`;
    const yOffset =
      hexY -
      LAYOUT_CONFIG.NORTH_OFFSET_BASE -
      i * LAYOUT_CONFIG.NORTH_OFFSET_STEP;
    const adapterX =
      hexX + hexDimension / 2 - LAYOUT_CONFIG.ADAPTER_NODE_WIDTH / 2;

    nodes.push({
      id: nodeId,
      type: "adapter" as HexagonNodeType,
      label: item,
      side: "north",
      category: "primary-adapter",
      position: { x: adapterX, y: yOffset },
    });

    edges.push({
      id: `e-${nodeId}`,
      source: nodeId,
      target: contextId,
      targetHandle: "north",
      type: "smoothstep",
    });
  });

  // --- South: External Integrations (Secondary Port) ----------------------
  southItems.forEach((item, i) => {
    const nodeId = `adapter-${contextId}-south-${item}-${i}`;
    const yOffset =
      hexY +
      LAYOUT_CONFIG.SOUTH_OFFSET_BASE +
      LAYOUT_CONFIG.SOUTH_OFFSET_ADDITIONAL +
      i * LAYOUT_CONFIG.SOUTH_OFFSET_STEP;
    const adapterX =
      hexX + hexDimension / 2 - LAYOUT_CONFIG.ADAPTER_NODE_WIDTH / 2;

    nodes.push({
      id: nodeId,
      type: "adapter" as HexagonNodeType,
      label: item,
      side: "south",
      category: "secondary-port",
      position: { x: adapterX, y: yOffset },
    });

    edges.push({
      id: `e-${nodeId}`,
      source: contextId,
      sourceHandle: "south",
      target: nodeId,
      targetHandle: "south",
      type: "smoothstep",
    });
  });

  // --- West: Presentation (Primary Adapter) -------------------------------
  westItems.forEach((item, i) => {
    const nodeId = `port-in-${contextId}-${item}-${i}`;
    const yOffset =
      hexY +
      LAYOUT_CONFIG.PORT_OFFSET_BASE_Y +
      i * LAYOUT_CONFIG.PORT_OFFSET_STEP_Y;

    nodes.push({
      id: nodeId,
      type: "adapter" as HexagonNodeType,
      label: item,
      side: "west",
      category: "primary-adapter",
      style: { width: 180, zIndex: 20 },
      position: { x: hexX + LAYOUT_CONFIG.WEST_PORT_OFFSET_X, y: yOffset },
    });

    edges.push({
      id: `edge-${nodeId}`,
      source: nodeId,
      sourceHandle: "east",
      target: contextId,
      targetHandle: "west",
      type: "smoothstep",
    });
  });

  // --- East: State & Storage (Secondary Port) -----------------------------
  eastItems.forEach((item, i) => {
    const nodeId = `port-out-${contextId}-${item}-${i}`;
    const yOffset =
      hexY +
      LAYOUT_CONFIG.PORT_OFFSET_BASE_Y +
      i * LAYOUT_CONFIG.PORT_OFFSET_STEP_Y;

    nodes.push({
      id: nodeId,
      type: "adapter" as HexagonNodeType,
      label: item,
      side: "east",
      category: "secondary-port",
      style: { width: 180, zIndex: 20 },
      position: { x: hexX + LAYOUT_CONFIG.EAST_PORT_OFFSET_X, y: yOffset },
    });

    edges.push({
      id: `edge-${nodeId}`,
      source: contextId,
      sourceHandle: "east",
      target: nodeId,
      targetHandle: "west",
      type: "smoothstep",
    });
  });

  return { nodes, edges };
}
