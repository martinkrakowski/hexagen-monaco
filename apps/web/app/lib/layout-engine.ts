import type {
  WizardData,
  ExternalContext,
  BoundedContext,
  PeerMapping,
} from "@hexagen/shared";
import type {
  HexagonNodeType,
  HexagonEdge,
  HexagonNode,
} from "@hexagen/visualization";

export interface HexagonNodeWithLayout extends HexagonNode {
  parentId?: string;
  extent?: "parent";
  isRoot?: boolean;
  isPeer?: boolean;
  side?: "north" | "south" | "east" | "west";
  draggable?: boolean;
  category?: string;
  style?: { width?: number; height?: number; zIndex?: number };
  stats?: {
    aggregates: number;
    aggregateItems: string[];
    valueObjects: number;
    valueObjectItems: string[];
    events: number;
    eventItems: string[];
    services: number;
    serviceItems: string[];
  };
}

/**
 * Layout configuration constants for hexagonal context map generation.
 * Extracted from hardcoded calculations to improve maintainability and reduce magic numbers.
 */
const LAYOUT_CONFIG = {
  // Viewport center (canvas coordinates)
  CENTER_X: 400,
  CENTER_Y: 300,

  // Group (monorepo boundary) dimensions
  GROUP_SPACING: 1200,
  GROUP_MIN_WIDTH: 1400,

  // Hexagon dimensions
  ROOT_HEX_DIMENSION: 500,
  SATELLITE_HEX_DIMENSION: 360,

  // Position offsets (relative to hex center)
  HEX_POSITION_OFFSET_X: -300,
  HEX_POSITION_OFFSET_Y: -260,

  // Inner node positions (inside root hexagon - 500px)
  DOMAIN_NODE_X: 110,
  DOMAIN_NODE_Y: 400,
  USECASES_NODE_X: 275,
  USECASES_NODE_Y: 400,

  // Satellite/peer hexagon inner node positions (360px hex - at bottom, spread apart)
  SATELLITE_DOMAIN_X: 50,
  SATELLITE_DOMAIN_Y: 320,
  SATELLITE_USECASES_X: 240,
  SATELLITE_USECASES_Y: 320,

  // Entity satellites positioning (root hex)
  ENTITY_COL_WIDTH: 50,
  ENTITY_ROW_HEIGHT: 40,
  ENTITY_START_X: 30,
  ENTITY_START_Y: 460,

  // Entity satellites positioning (satellite hex - below Domain)
  SATELLITE_ENTITY_START_X: -20,
  SATELLITE_ENTITY_START_Y: 600,

  // Use case satellites positioning (root hex)
  USECASE_COL_WIDTH: 50,
  USECASE_ROW_HEIGHT: 40,
  USECASE_START_X: 420,
  USECASE_START_Y: 460,

  // Use case satellites positioning (satellite hex - below Use Cases)
  SATELLITE_USECASE_START_X: 320,
  SATELLITE_USECASE_START_Y: 600,

  // Adapter positions (north/south of hex)
  NORTH_OFFSET_BASE: 220,
  NORTH_OFFSET_STEP: 100,
  SOUTH_OFFSET_BASE: 520,
  SOUTH_OFFSET_ADDITIONAL: 60,
  SOUTH_OFFSET_STEP: 100,

  // Port satellites (west/east driving/driven)
  WEST_PORT_OFFSET_X: -220,
  EAST_PORT_OFFSET_X: 520,
  PORT_OFFSET_BASE_Y: -40,
  PORT_OFFSET_STEP_Y: 80,

  // Adapter label X position
  ADAPTER_LABEL_X: 230,

  // External peer positioning
  PEER_OFFSET_LEFT: -400,
  PEER_OFFSET_RIGHT: 100,
  PEER_Y_STEP: 300,
} as const;

export function generateHexagonalContextMap(wizardData: WizardData): {
  nodes: HexagonNodeWithLayout[];
  edges: HexagonEdge[];
} {
  const nodes: HexagonNodeWithLayout[] = [];
  const edges: HexagonEdge[] = [];

  const boundedContexts = wizardData.boundedContexts ?? [];
  const externalContexts = wizardData.externalContexts ?? [];

  // Center of the viewport (using config constants)
  const canvasCenterX = LAYOUT_CONFIG.CENTER_X;
  const canvasCenterY = LAYOUT_CONFIG.CENTER_Y;

  // Calculate group size based on number of bounded contexts
  const contextCount = boundedContexts.length;
  const contextSpacing = LAYOUT_CONFIG.GROUP_SPACING;
  const groupWidth = Math.max(
    LAYOUT_CONFIG.GROUP_MIN_WIDTH,
    contextCount * contextSpacing + 400,
  );
  const groupHeight = 1000;

  // Place group centered in viewport
  const groupX = canvasCenterX - groupWidth / 2;
  const groupY = canvasCenterY - groupHeight / 2;

  // 1. Add Group Node (root node - no parentId or extent)
  nodes.push({
    id: "monorepo-boundary",
    type: "group" as HexagonNodeType,
    label: "MONOREPO BOUNDARY",
    position: { x: groupX, y: groupY },
    style: { width: groupWidth, height: groupHeight },
  });

  // 2. Add Hexagons with adapters - spaced horizontally (using config constants)
  const groupCenterX = groupX + groupWidth / 2;
  const groupCenterY = groupY + groupHeight / 2;

  boundedContexts.forEach((ctx: BoundedContext, index: number) => {
    const entityItems = ctx.coreDomainEntities ?? ctx.entities ?? [];
    const useCaseItems = ctx.useCases ?? [];
    const valueObjectItems = ctx.valueObjects ?? [];
    const eventItems = ctx.domainEvents ?? [];

    // Calculate position for each context (horizontal spacing using config constants)
    const contextOffsetX = (index - (contextCount - 1) / 2) * contextSpacing;
    const hexX =
      groupCenterX + contextOffsetX + LAYOUT_CONFIG.HEX_POSITION_OFFSET_X;
    const hexY = groupCenterY + LAYOUT_CONFIG.HEX_POSITION_OFFSET_Y;

    // Hexagon - root is ROOT_HEX_DIMENSION, non-root (satellite) uses SATELLITE_HEX_DIMENSION
    const hexDimension =
      index === 0
        ? LAYOUT_CONFIG.ROOT_HEX_DIMENSION
        : LAYOUT_CONFIG.SATELLITE_HEX_DIMENSION;
    // Calculate position relative to monorepo boundary group
    const hexRelativeX = hexX - groupX;
    const hexRelativeY = hexY - groupY;
    nodes.push({
      id: ctx.id || `context-${index}`,
      type: "bounded-context" as HexagonNodeType,
      label: ctx.name || `Context ${index + 1}`,
      position: { x: hexRelativeX, y: hexRelativeY },
      parentId: "monorepo-boundary",
      extent: "parent",
      isRoot: index === 0,
      draggable: index === 0, // Only root hexagon is draggable
      style: { width: hexDimension, height: hexDimension },
      stats: {
        aggregates: entityItems.length,
        aggregateItems: entityItems,
        valueObjects: valueObjectItems.length,
        valueObjectItems: valueObjectItems,
        events: eventItems.length,
        eventItems: eventItems,
        services: useCaseItems.length,
        serviceItems: useCaseItems,
      },
    });

    const contextId = ctx.id || `context-${index}`;
    const isRootContext = index === 0;

    // Select appropriate config based on context type
    // Note: Domain/Use Cases inner nodes use parentId, so they render relative to parent automatically
    // Only satellites need offset calculation (done inline where they're created)
    const domainX = isRootContext
      ? LAYOUT_CONFIG.DOMAIN_NODE_X
      : LAYOUT_CONFIG.SATELLITE_DOMAIN_X;
    const domainY = isRootContext
      ? LAYOUT_CONFIG.DOMAIN_NODE_Y
      : LAYOUT_CONFIG.SATELLITE_DOMAIN_Y;
    const useCasesX = isRootContext
      ? LAYOUT_CONFIG.USECASES_NODE_X
      : LAYOUT_CONFIG.SATELLITE_USECASES_X;
    const useCasesY = isRootContext
      ? LAYOUT_CONFIG.USECASES_NODE_Y
      : LAYOUT_CONFIG.SATELLITE_USECASES_Y;
    // For satellites we will position children in absolute canvas coords using hexX/hexY
    const entityStartX = isRootContext
      ? LAYOUT_CONFIG.ENTITY_START_X
      : LAYOUT_CONFIG.SATELLITE_ENTITY_START_X;
    const entityStartY = isRootContext
      ? LAYOUT_CONFIG.ENTITY_START_Y
      : LAYOUT_CONFIG.SATELLITE_ENTITY_START_Y;
    const useCaseStartX = isRootContext
      ? LAYOUT_CONFIG.USECASE_START_X
      : LAYOUT_CONFIG.SATELLITE_USECASE_START_X;
    const useCaseStartY = isRootContext
      ? LAYOUT_CONFIG.USECASE_START_Y
      : LAYOUT_CONFIG.SATELLITE_USECASE_START_Y;

    // Add static Domain node inside hexagon
    const domainNodeId = `domain-${contextId}`;
    nodes.push({
      id: domainNodeId,
      label: "Domain",
      type: "inner" as HexagonNodeType,
      category: "Domain",
      parentId: contextId,
      extent: "parent",
      draggable: false,
      position: { x: domainX, y: domainY },
    });

    // Add static Use Cases node inside hexagon
    const useCasesNodeId = `usecases-${contextId}`;
    nodes.push({
      id: useCasesNodeId,
      label: "Use Cases",
      type: "inner" as HexagonNodeType,
      category: "Use Cases",
      parentId: contextId,
      extent: "parent",
      draggable: false,
      position: { x: useCasesX, y: useCasesY },
    });

    // Entity satellites - absolute positioning for satellites
    entityItems.forEach((name: string, i: number) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const posX = isRootContext
        ? entityStartX + col * LAYOUT_CONFIG.ENTITY_COL_WIDTH
        : hexX +
          LAYOUT_CONFIG.SATELLITE_ENTITY_START_X +
          col * LAYOUT_CONFIG.ENTITY_COL_WIDTH;
      const posY = isRootContext
        ? entityStartY + row * LAYOUT_CONFIG.ENTITY_ROW_HEIGHT
        : hexY +
          LAYOUT_CONFIG.SATELLITE_ENTITY_START_Y +
          row * LAYOUT_CONFIG.ENTITY_ROW_HEIGHT;
      nodes.push({
        id: `entity-${contextId}-${i}`,
        label: name,
        type: "entity" as HexagonNodeType,
        category: "Entity",
        parentId: isRootContext ? contextId : undefined,
        extent: isRootContext ? "parent" : undefined,
        position: { x: posX, y: posY },
      });
      // Edge from domain (south handle) to entity (north handle)
      edges.push({
        id: `edge-${contextId}-entity-${i}`,
        source: domainNodeId,
        sourceHandle: "south",
        target: `entity-${contextId}-${i}`,
        targetHandle: "north",
        type: "smoothstep",
      });
    });

    // Use case satellites - absolute positioning for satellites
    useCaseItems.forEach((name: string, i: number) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const posX = isRootContext
        ? useCaseStartX + col * LAYOUT_CONFIG.USECASE_COL_WIDTH
        : hexX +
          LAYOUT_CONFIG.SATELLITE_USECASE_START_X +
          col * LAYOUT_CONFIG.USECASE_COL_WIDTH;
      const posY = isRootContext
        ? useCaseStartY + row * LAYOUT_CONFIG.USECASE_ROW_HEIGHT
        : hexY +
          LAYOUT_CONFIG.SATELLITE_USECASE_START_Y +
          row * LAYOUT_CONFIG.USECASE_ROW_HEIGHT;
      nodes.push({
        id: `usecase-${contextId}-${i}`,
        label: name,
        type: "use-case" as HexagonNodeType,
        category: "Use Case",
        parentId: isRootContext ? contextId : undefined,
        extent: isRootContext ? "parent" : undefined,
        position: { x: posX, y: posY },
      });
      // Edge from use cases (south handle) to use case (north handle)
      edges.push({
        id: `edge-${contextId}-usecase-${i}`,
        source: useCasesNodeId,
        sourceHandle: "south",
        target: `usecase-${contextId}-${i}`,
        targetHandle: "north",
        type: "smoothstep",
      });
    });

    // Collect all adapters for this context with unique handle IDs
    const adapters: Array<{
      id: string;
      label: string;
      side: "north" | "south";
      handleIndex: number;
    }> = [];

    // North adapters - stacked (API first, then UI) using config constants
    let northCount = 0;
    // Support both legacy apiFramework and new infrastructureTarget
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

    // South adapters - stacked (Messaging first, then Persistence) using config constants
    let southCount = 0;
    if (ctx.messagingAdapter) {
      adapters.push({
        id: `adapter-${contextId}-${ctx.messagingAdapter}`,
        label: ctx.messagingAdapter,
        side: "south",
        handleIndex: southCount++,
      });
    }
    if (ctx.persistenceAdapter) {
      adapters.push({
        id: `adapter-${contextId}-${ctx.persistenceAdapter}`,
        label: ctx.persistenceAdapter,
        side: "south",
        handleIndex: southCount++,
      });
    }

    // Create adapter nodes and edges using config constants
    adapters.forEach((adapter) => {
      let yOffset: number;
      let edgeConfig: {
        source: string;
        target: string;
        sourceHandle?: string;
        targetHandle: string;
      };

      if (adapter.side === "north") {
        yOffset =
          hexY -
          LAYOUT_CONFIG.NORTH_OFFSET_BASE -
          adapter.handleIndex * LAYOUT_CONFIG.NORTH_OFFSET_STEP;
        // Adapter connects TO hexagon - adapter is source, hexagon has target handle
        edgeConfig = {
          source: adapter.id,
          target: ctx.id || `context-${index}`,
          targetHandle: `north-${adapter.handleIndex}`,
        };
      } else {
        yOffset =
          hexY +
          LAYOUT_CONFIG.SOUTH_OFFSET_BASE +
          LAYOUT_CONFIG.SOUTH_OFFSET_ADDITIONAL +
          adapter.handleIndex * LAYOUT_CONFIG.SOUTH_OFFSET_STEP;
        // Hexagon connects TO adapter - hexagon is source (with south handle), adapter is target
        edgeConfig = {
          source: ctx.id || `context-${index}`,
          target: adapter.id,
          sourceHandle: `south-${adapter.handleIndex}`,
          targetHandle: `south`,
        };
      }

      // Determine the type label (for category badge)
      let typeLabel = adapter.side === "north" ? "API" : "Infrastructure";
      if (
        adapter.label.toLowerCase().includes("react") ||
        adapter.label.toLowerCase().includes("next") ||
        adapter.label.toLowerCase().includes("remix") ||
        adapter.label.toLowerCase().includes("vue") ||
        adapter.label.toLowerCase().includes("angular")
      ) {
        typeLabel = "UI";
      } else if (
        adapter.label.toLowerCase().includes("messaging") ||
        adapter.label.toLowerCase().includes("kafka") ||
        adapter.label.toLowerCase().includes("rabbit")
      ) {
        typeLabel = "Messaging";
      } else if (
        adapter.label.toLowerCase().includes("prisma") ||
        adapter.label.toLowerCase().includes("typeorm") ||
        adapter.label.toLowerCase().includes("sql")
      ) {
        typeLabel = "Persistence";
      }

      nodes.push({
        id: adapter.id,
        type: "port" as HexagonNodeType,
        label: adapter.label,
        category: typeLabel,
        position: { x: hexX + LAYOUT_CONFIG.ADAPTER_LABEL_X, y: yOffset },
        side: adapter.side,
      });

      edges.push({
        id: `e-${adapter.id}`,
        source: edgeConfig.source,
        target: edgeConfig.target,
        sourceHandle: edgeConfig.sourceHandle,
        targetHandle: edgeConfig.targetHandle,
        type: "smoothstep",
      });
    });

    // --- Port Configuration (Driving/Driven) ---
    const inboundPorts = ctx.portConfiguration?.inboundPorts ?? [];
    const outboundPorts = ctx.portConfiguration?.outboundPorts ?? [];

    // West (Driving) ports: edge from port -> hex west handle
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
        position: {
          x: hexX + LAYOUT_CONFIG.WEST_PORT_OFFSET_X,
          y: yOffset,
        },
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

    // East (Driven) ports: edge from hex east handle -> port
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
        position: {
          x: hexX + LAYOUT_CONFIG.EAST_PORT_OFFSET_X,
          y: yOffset,
        },
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
  });

  // 3. External Peers - positioned outside the group using config constants
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

    edges.push({
      id: `edge-peer-${bc.id}`,
      source: isUpstream ? bc.id : boundedContexts[0]?.id || "context-0",
      target: isUpstream ? boundedContexts[0]?.id || "context-0" : bc.id,
      label: `${bc.relationshipType} ${bc.name}`,
      type: "smoothstep",
      animated: true,
    });
  });

  // 4. Peer Context Mappings - create edges between bounded contexts (East → West)
  // Consumer (East/Source) calls Provider (West/Target) - follows DDD domain interface pattern
  // Edge routes below the hexagons to avoid penetrating the nodes
  const peerMappings = wizardData.peerMappings ?? [];
  peerMappings.forEach((mapping, index) => {
    const consumerId = mapping.consumerContext;
    const providerId = mapping.providerContext;

    // Find the context nodes
    const consumerNode = nodes.find(
      (n) =>
        n.id === consumerId ||
        n.id ===
          `context-${boundedContexts.findIndex((c) => c.id === consumerId)}`,
    );
    const providerNode = nodes.find(
      (n) =>
        n.id === providerId ||
        n.id ===
          `context-${boundedContexts.findIndex((c) => c.id === providerId)}`,
    );

    if (consumerNode && providerNode) {
      // Get context names for label
      const consumerCtx = boundedContexts.find((c) => c.id === consumerId);
      const providerCtx = boundedContexts.find((c) => c.id === providerId);

      // Calculate edge routing - go below the hexagons to avoid penetrating nodes
      // Get the y position below both hexagons
      const consumerY =
        consumerNode.position.y + (consumerNode.style?.height ?? 360);
      const providerY =
        providerNode.position.y + (providerNode.style?.height ?? 360);
      const routeY = Math.max(consumerY, providerY) + 60; // 60px buffer below hexagons

      // Calculate start/end x positions
      const consumerX =
        consumerNode.position.x + (consumerNode.style?.width ?? 360);
      const providerX = providerNode.position.x;

      // Create waypoints to route below the hexagons
      const midX = (consumerX + providerX) / 2;

      edges.push({
        id: `edge-peer-mapping-${index}`,
        source: consumerId,
        sourceHandle: "east",
        target: providerId,
        targetHandle: "west",
        label: `${consumerCtx?.name || "?"} → ${providerCtx?.name || "?"} (${mapping.integrationPattern === "open-host" ? "OHS" : "ACL"})`,
        type: "smoothstep",
        animated: true,
      });
    }
  });

  return { nodes, edges };
}
