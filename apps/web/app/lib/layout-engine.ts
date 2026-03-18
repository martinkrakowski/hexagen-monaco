import type {
  WizardData,
  ExternalContext,
  BoundedContext,
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
    services: number;
    serviceItems: string[];
  };
}

export function generateHexagonalContextMap(wizardData: WizardData): {
  nodes: HexagonNodeWithLayout[];
  edges: HexagonEdge[];
} {
  const nodes: HexagonNodeWithLayout[] = [];
  const edges: HexagonEdge[] = [];

  const boundedContexts = wizardData.boundedContexts ?? [];
  const externalContexts = wizardData.externalContexts ?? [];

  // Center of the viewport
  const canvasCenterX = 400;
  const canvasCenterY = 300;

  // Calculate group size based on number of bounded contexts
  const contextCount = boundedContexts.length;
  const contextSpacing = 700;
  const groupWidth = Math.max(1200, contextCount * contextSpacing + 400);
  const groupHeight = 1000;

  // Place group centered in viewport
  const groupX = canvasCenterX - groupWidth / 2;
  const groupY = canvasCenterY - groupHeight / 2;

  // 1. Add Group Node
  nodes.push({
    id: "monorepo-boundary",
    type: "group" as HexagonNodeType,
    label: "MONOREPO BOUNDARY",
    position: { x: groupX, y: groupY },
    style: { width: groupWidth, height: groupHeight },
  });

  // 2. Add Hexagons with adapters - spaced horizontally
  const groupCenterX = groupX + groupWidth / 2;
  const groupCenterY = groupY + groupHeight / 2;

  boundedContexts.forEach((ctx: BoundedContext, index: number) => {
    const entityItems = ctx.entities ?? [];
    const useCaseItems = ctx.useCases ?? [];

    // Calculate position for each context (horizontal spacing)
    const contextOffsetX = (index - (contextCount - 1) / 2) * contextSpacing;
    const hexX = groupCenterX + contextOffsetX - 300;
    const hexY = groupCenterY - 260;

    // Hexagon
    nodes.push({
      id: ctx.id || `context-${index}`,
      type: "bounded-context" as HexagonNodeType,
      label: ctx.name || `Context ${index + 1}`,
      position: { x: hexX, y: hexY },
      isRoot: index === 0,
      draggable: false,
      stats: {
        aggregates: entityItems.length,
        aggregateItems: entityItems,
        services: useCaseItems.length,
        serviceItems: useCaseItems,
      },
    });

    // Entity satellites (west/side of hexagon)
    entityItems.forEach((name: string, i: number) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const contextId = ctx.id || `context-${index}`;
      nodes.push({
        id: `entity-${contextId}-${i}`,
        label: name,
        type: "entity" as HexagonNodeType,
        category: "Entity",
        position: {
          x: hexX - 250 + col * 120,
          y: hexY - 50 + row * 30,
        },
      });
      // Edge from hexagon to entity
      edges.push({
        id: `edge-${contextId}-entity-${i}`,
        source: contextId,
        target: `entity-${contextId}-${i}`,
        targetHandle: "west",
        type: "smoothstep",
      });
    });

    // Use case satellites (east/side of hexagon)
    useCaseItems.forEach((name: string, i: number) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const contextId = ctx.id || `context-${index}`;
      nodes.push({
        id: `usecase-${contextId}-${i}`,
        label: name,
        type: "use-case" as HexagonNodeType,
        category: "Use Case",
        position: {
          x: hexX + 500 + col * 120,
          y: hexY - 50 + row * 30,
        },
      });
      // Edge from hexagon to use case
      edges.push({
        id: `edge-${contextId}-usecase-${i}`,
        source: contextId,
        target: `usecase-${contextId}-${i}`,
        sourceHandle: "east",
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

    // North adapters - stacked (API first, then UI)
    let northCount = 0;
    const contextId = ctx.id || `context-${index}`;
    if (ctx.apiFramework) {
      adapters.push({
        id: `adapter-${contextId}-${ctx.apiFramework}`,
        label: ctx.apiFramework,
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

    // South adapters - stacked (Messaging first, then Persistence)
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

    // Create adapter nodes and edges
    adapters.forEach((adapter) => {
      let yOffset: number;
      let edgeConfig: {
        source: string;
        target: string;
        sourceHandle?: string;
        targetHandle: string;
      };

      if (adapter.side === "north") {
        yOffset = hexY - 220 - adapter.handleIndex * 100;
        // Adapter connects TO hexagon - adapter is source, hexagon has target handle
        edgeConfig = {
          source: adapter.id,
          target: ctx.id || `context-${index}`,
          targetHandle: `north-${adapter.handleIndex}`,
        };
      } else {
        yOffset = hexY + 520 + 60 + adapter.handleIndex * 100;
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
        adapter.label.toLowerCase().includes("ui")
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
        position: { x: hexX + 230, y: yOffset },
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
  });

  // 3. External Peers - positioned outside the group
  externalContexts.forEach((bc: ExternalContext, index: number) => {
    const isUpstream =
      bc.relationshipType === "U" || bc.relationshipType === "OHS";
    const tx = isUpstream ? groupX - 400 : groupX + groupWidth + 100;
    const ty = canvasCenterY + index * 300 - 150;

    nodes.push({
      id: bc.id,
      type: "bounded-context" as HexagonNodeType,
      label: bc.name,
      position: { x: tx, y: ty },
      isPeer: true,
      stats: {
        aggregates: bc.entityNames?.length ?? 0,
        aggregateItems: bc.entityNames ?? [],
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

  return { nodes, edges };
}
