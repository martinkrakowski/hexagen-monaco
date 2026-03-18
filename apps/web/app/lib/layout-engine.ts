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

  // Center of the viewport (we'll use these as absolute coordinates)
  const canvasCenterX = 400;
  const canvasCenterY = 300;

  // Group dimensions
  const groupWidth = 1200;
  const groupHeight = 1000;

  // Place group centered in viewport
  const groupX = canvasCenterX - groupWidth / 2;
  const groupY = canvasCenterY - groupHeight / 2;

  // 1. Add Group Node (NOT as parent - just visual boundary)
  nodes.push({
    id: "monorepo-boundary",
    type: "group" as HexagonNodeType,
    label: "MONOREPO BOUNDARY",
    position: { x: groupX, y: groupY },
    style: { width: groupWidth, height: groupHeight },
  });

  // 2. Add Hexagon centered WITHIN the group box (absolute coordinates)
  // Group center is groupX + groupWidth/2, groupY + groupHeight/2
  const groupCenterX = groupX + groupWidth / 2;
  const groupCenterY = groupY + groupHeight / 2;

  boundedContexts.forEach((ctx: BoundedContext, index: number) => {
    const entityItems = ctx.entities ?? [];
    const useCaseItems = ctx.useCases ?? [];

    // Hexagon at the CENTER of the group (absolute position)
    const hexX = groupCenterX - 300; // half of 600px width
    const hexY = groupCenterY - 260; // half of 520px height

    // Hexagon at the CENTER of the group (absolute position, not draggable)
    nodes.push({
      id: ctx.id || `context-${index}`,
      type: "bounded-context" as HexagonNodeType,
      label: ctx.name || `Context ${index + 1}`,
      position: { x: hexX, y: hexY },
      isRoot: index === 0,
      draggable: false, // Fixed position, not draggable
      stats: {
        aggregates: entityItems.length,
        aggregateItems: entityItems,
        services: useCaseItems.length,
        serviceItems: useCaseItems,
      },
    });

    // API / Presentation (North) - above hexagon (draggable)
    if (ctx.apiFramework) {
      const apiId = `adapter-${ctx.apiFramework}`;
      nodes.push({
        id: apiId,
        type: "port" as HexagonNodeType,
        label: ctx.apiFramework,
        position: { x: groupCenterX - 70, y: hexY - 220 },
        side: "north",
        // No parentId - this node is draggable
      });
      edges.push({
        id: `e-${apiId}`,
        source: apiId,
        target: ctx.id || `context-${index}`,
        targetHandle: "north",
        type: "smoothstep",
      });
    }

    // DB / Infrastructure (South) - below hexagon (draggable)
    if (ctx.persistenceAdapter) {
      const dbId = `adapter-${ctx.persistenceAdapter}`;
      nodes.push({
        id: dbId,
        type: "port" as HexagonNodeType,
        label: ctx.persistenceAdapter,
        position: { x: groupCenterX - 70, y: hexY + 520 + 60 },
        side: "south",
        // No parentId - this node is draggable
      });
      edges.push({
        id: `e-${dbId}`,
        source: ctx.id || `context-${index}`,
        target: dbId,
        sourceHandle: "south",
        type: "smoothstep",
      });
    }
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
