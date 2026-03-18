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

  const centerX = 2000;
  const centerY = 2000;

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

    // Create edges to infrastructure adapters based on context settings
    if (ctx.apiFramework) {
      edges.push({
        id: `edge-${ctx.id}-api`,
        source: ctx.id || `context-${index}`,
        target: `adapter-${ctx.apiFramework}`,
        targetHandle: "west",
        type: "smoothstep",
      });
    }
    if (ctx.persistenceAdapter) {
      edges.push({
        id: `edge-${ctx.id}-db`,
        source: `adapter-${ctx.persistenceAdapter}`,
        target: ctx.id || `context-${index}`,
        targetHandle: "south",
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

    // Connect to first bounded context
    const rootId = boundedContexts[0]?.id || "context-0";
    const isDownstream = bc.relationshipType === "D";
    edges.push({
      id: `edge-peer-${bc.id}`,
      source: isDownstream ? bc.id : rootId,
      target: isDownstream ? rootId : bc.id,
      label: bc.relationshipType,
      type: "smoothstep",
      animated: !!bc.isEventDriven,
    });
  });

  return { nodes, edges };
}
