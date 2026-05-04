import type { BoundedContext } from "@hexagen/project-configuration";
import type {
  HexagonNodeType,
  HexagonNodeWithLayout,
  HexagonEdge,
} from "../../../domain/index.js";

import { LAYOUT_CONFIG, staggerYFor } from "./config.js";
import { generateInnerNodes } from "./generate-inner-nodes.js";
import { generateCompassNodes } from "./generate-compass-nodes.js";

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

  const innerResult = generateInnerNodes(
    ctx,
    contextId,
    hexX,
    hexY,
    isRootContext,
  );
  nodes.push(...innerResult.nodes);
  edges.push(...innerResult.edges);

  const compassResult = generateCompassNodes(
    ctx,
    contextId,
    hexX,
    hexY,
    hexDimension,
  );
  nodes.push(...compassResult.nodes);
  edges.push(...compassResult.edges);

  return { nodes, edges };
}
