import type { MapContextInput } from "../../../application/ports/in/hexagonal-map-input.js";
import type {
  RenderableHexagonEdge,
  RenderableHexagonNode,
} from "../../../application/ports/in/renderable-graph.js";
import type { HexagonNodeType } from "../../../domain/index.js";

import { LAYOUT_CONFIG } from "./config.js";

const EAST_OUTBOUND_PORTS = new Set<string>(["relational-db", "document-db"]);

interface CompassOutput {
  nodes: RenderableHexagonNode[];
  edges: RenderableHexagonEdge[];
}

function generateCompassNodes(
  ctx: MapContextInput,
  contextId: string,
  hexX: number,
  hexY: number,
  hexDimension: number,
): CompassOutput {
  const nodes: RenderableHexagonNode[] = [];
  const edges: RenderableHexagonEdge[] = [];

  const apiLabel = ctx.infrastructureTarget
    ? ctx.infrastructureTarget.charAt(0).toUpperCase() +
      ctx.infrastructureTarget.slice(1)
    : ctx.apiFramework;

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

export { generateCompassNodes };
