import type {
  WizardData,
  ExternalContext,
  BoundedContext,
  DomainEventRef,
} from "@hexagen/shared";
import type { HexagonNode, HexagonEdge } from "@hexagen/visualization";

export type HexagonNodeWithLayout = HexagonNode & {
  isRoot?: boolean;
  isPeer?: boolean;
  isBoundedContext?: boolean;
  side?: "north" | "south" | "east" | "west";
  publishedEvents?: DomainEventRef[];
  subscribedEvents?: DomainEventRef[];
  category?: string;
  parentId?: string;
  extent?: "parent";
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
};

export function generateHexagonalContextMap(wizardData: WizardData): {
  nodes: HexagonNodeWithLayout[];
  edges: HexagonEdge[];
} {
  const nodes: HexagonNodeWithLayout[] = [];
  const edges: HexagonEdge[] = [];

  const centerX = 400;
  const centerY = 300;

  const boundedContexts = wizardData.boundedContexts ?? [];
  const externalContexts = wizardData.externalContexts ?? [];

  // Render multiple bounded contexts in a cluster at the center
  const contextCount = boundedContexts.length;
  const contextSpacing = 550;

  boundedContexts.forEach((ctx: BoundedContext, index: number) => {
    const isFirst = index === 0;
    const offsetX = (index - (contextCount - 1) / 2) * contextSpacing;
    const tx = centerX + offsetX;
    const ty = centerY;

    const entityItems = ctx.entities ?? [];
    const useCaseItems = ctx.useCases ?? [];

    nodes.push({
      id: ctx.id || `context-${index}`,
      label: ctx.name || `Context ${index + 1}`,
      type: "bounded-context",
      position: { x: tx - 200, y: ty - 200 },
      isRoot: isFirst,
      isBoundedContext: true,
      stats: {
        aggregates: entityItems.length,
        aggregateItems: entityItems,
        services: useCaseItems.length,
        serviceItems: useCaseItems,
        valueObjects: 0,
        valueObjectItems: [],
        events: 0,
        eventItems: [],
      },
    });

    // Add satellite nodes for root context entities and use cases
    const rootCenterX = tx;
    const rootCenterY = ty;
    const rootDimension = 500;

    // Entity satellites (compact rectangles in upper-left portion)
    entityItems.forEach((name: string, i: number) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      nodes.push({
        id: `${ctx.id}-entity-${i}`,
        label: name,
        type: "entity",
        position: {
          x: rootCenterX - 180 + col * 160,
          y: rootCenterY - rootDimension / 3 + row * 25,
        },
        parentId: ctx.id,
        category: "entities",
        extent: "parent",
      });
    });

    // Use case satellites (compact rectangles in upper-right portion)
    useCaseItems.forEach((name: string, i: number) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      nodes.push({
        id: `${ctx.id}-usecase-${i}`,
        label: name,
        type: "use-case",
        position: {
          x: rootCenterX - 180 + col * 160,
          y: rootCenterY + rootDimension / 8 + row * 25,
        },
        parentId: ctx.id,
        category: "useCases",
        extent: "parent",
      });
    });

    // Create adapter nodes for infrastructure frameworks/adapters
    if (ctx.apiFramework) {
      const apiAdapterId = `adapter-${ctx.apiFramework}`;
      nodes.push({
        id: apiAdapterId,
        label: `${ctx.apiFramework} API`,
        type: "port",
        parentId: ctx.id || `context-${index}`,
        category: "infrastructure",
        position: { x: rootCenterX + 120, y: rootCenterY - 50 },
      });
      edges.push({
        id: `edge-${ctx.id}-api`,
        source: ctx.id || `context-${index}`,
        target: apiAdapterId,
        type: "smoothstep",
      });
    }
    if (ctx.persistenceAdapter) {
      const dbAdapterId = `adapter-${ctx.persistenceAdapter}`;
      nodes.push({
        id: dbAdapterId,
        label: `${ctx.persistenceAdapter} DB`,
        type: "port",
        parentId: ctx.id || `context-${index}`,
        category: "infrastructure",
        position: { x: rootCenterX + 120, y: rootCenterY + 80 },
      });
      edges.push({
        id: `edge-${ctx.id}-db`,
        source: dbAdapterId,
        target: ctx.id || `context-${index}`,
        type: "smoothstep",
      });
    }
  });

  // Render external contexts in outer orbit
  const outerOrbitRadius = 1100;

  externalContexts.forEach((bc: ExternalContext, index: number) => {
    const angle = (index / externalContexts.length) * 2 * Math.PI;
    const tx = centerX + outerOrbitRadius * Math.cos(angle);
    const ty = centerY + outerOrbitRadius * Math.sin(angle);

    const peerEntityNames = bc.entityNames ?? [];
    const peerUseCaseNames = bc.useCaseNames ?? [];

    nodes.push({
      id: bc.id,
      label: bc.name,
      type: "bounded-context",
      position: { x: tx - 150, y: ty - 150 },
      isPeer: true,
      stats: {
        aggregates: peerEntityNames.length,
        aggregateItems: peerEntityNames,
        services: peerUseCaseNames.length,
        serviceItems: peerUseCaseNames,
        valueObjects: 0,
        valueObjectItems: [],
        events: 0,
        eventItems: [],
      },
    });

    // Add satellite nodes for peer context entities and use cases
    const peerCenterX = tx;
    const peerCenterY = ty;
    const peerDimension = 300;

    // Entity satellites (compact rectangles in upper portion)
    peerEntityNames.forEach((name: string, i: number) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      nodes.push({
        id: `${bc.id}-entity-${i}`,
        label: name,
        type: "entity",
        position: {
          x: peerCenterX - 60 + col * 120,
          y: peerCenterY - peerDimension / 3 + row * 25,
        },
        parentId: bc.id,
        category: "entities",
        extent: "parent",
      });
    });

    // Use case satellites (compact rectangles in lower portion)
    peerUseCaseNames.forEach((name: string, i: number) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      nodes.push({
        id: `${bc.id}-usecase-${i}`,
        label: name,
        type: "use-case",
        position: {
          x: peerCenterX - 60 + col * 120,
          y: peerCenterY + peerDimension / 6 + row * 25,
        },
        parentId: bc.id,
        category: "useCases",
        extent: "parent",
      });
    });

    // Connect to first bounded context
    const rootId = boundedContexts[0]?.id || "context-0";
    const isDownstream = bc.relationshipType === "D";
    edges.push({
      id: `edge-peer-${bc.id}`,
      source: isDownstream ? bc.id : rootId,
      target: isDownstream ? rootId : bc.id,
      sourceHandle: "south",
      targetHandle: "south",
      label: bc.relationshipType,
      type: "smoothstep",
      animated: !!bc.isEventDriven,
    });
  });

  return { nodes, edges };
}
