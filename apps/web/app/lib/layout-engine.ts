import type { WizardData } from "@hexagen/shared";
import type { HexagonNode, HexagonEdge } from "@hexagen/visualization";

/**
 * Extension of the domain HexagonNode to include layout-specific metadata.
 * These fields ride along in state and are used by HexagonNode to determine
 * handle placement and scale. Not part of the core domain model.
 */
export type HexagonNodeWithLayout = HexagonNode & {
  isRoot?: boolean;
  side?: "north" | "south" | "east" | "west";
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

type Side = "north" | "south" | "east" | "west";

const SIDE_MAP: Record<string, Side> = {
  apiFramework: "east",
  uiFramework: "north",
  messagingAdapter: "north",
  webhookEndpoints: "north",
  persistenceAdapter: "south",
  telemetryProvider: "south",
  externalApiPorts: "west",
  llmProviders: "west",
  blockchainNetworks: "west",
  authenticationProvider: "west",
  emailService: "west",
  paymentGateway: "west",
  storageProvider: "west",
  searchService: "west",
};

// Fields handled by dedicated rendering passes — excluded from the generic
// SIDE_MAP grouping to avoid duplicate processing or spurious warnings.
const STRATEGIC_MAP_EXCLUDED = new Set(["rootName", "entities", "useCases"]);

export function generateHexagonalContextMap(wizardData: WizardData): {
  nodes: HexagonNodeWithLayout[];
  edges: HexagonEdge[];
} {
  const nodes: HexagonNodeWithLayout[] = [];
  const edges: HexagonEdge[] = [];

  const centerX = 2000;
  const centerY = 2000;
  const orbitRadius = 600;
  const stackGap = 180;

  // Derived domain item arrays — declared early so stats can reference them.
  const entityItems = (wizardData.entities ?? []).filter(Boolean);
  const useCaseItems = (wizardData.useCases ?? []).filter(Boolean);

  // Central root node — 500px component, centered at (centerX, centerY)
  nodes.push({
    id: "root-core",
    label: wizardData.rootName?.trim() || "Project Root",
    type: "bounded-context",
    position: { x: centerX - 250, y: centerY - 250 },
    isRoot: true,
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

  // Grouping pass — only SIDE_MAP keys are included
  const groups: Record<Side, { key: string; val: string | string[] }[]> = {
    north: [],
    south: [],
    east: [],
    west: [],
  };

  Object.entries(wizardData).forEach(([key, value]) => {
    const side = SIDE_MAP[key];
    if (value && side) {
      groups[side].push({ key, val: value as string | string[] });
    } else if (value && !STRATEGIC_MAP_EXCLUDED.has(key) && process.env.NODE_ENV === "development") {
      console.warn(
        `[layout-engine] WizardData key "${key}" has a value but no SIDE_MAP entry — it will not appear on the context map. Add it to SIDE_MAP to include it.`,
      );
    }
  });

  // Positioning and edge generation — deterministic cardinal stacking
  (Object.entries(groups) as [Side, { key: string; val: string | string[] }[]][]).forEach(
    ([side, items]) => {
      items.forEach((item, index) => {
        const total = items.length;
        const offset = (index - (total - 1) / 2) * stackGap;

        let tx = centerX;
        let ty = centerY;

        if (side === "east") { tx += orbitRadius; ty += offset; }
        else if (side === "west") { tx -= orbitRadius; ty += offset; }
        else if (side === "north") { tx += offset; ty -= orbitRadius; }
        else if (side === "south") { tx += offset; ty += orbitRadius; }

        const displayVal = Array.isArray(item.val)
          ? item.val.join(", ")
          : String(item.val);
        const category = item.key.replace(/([A-Z])/g, " $1").trim();

        // Satellite node — 160px component, centered at (tx, ty)
        nodes.push({
          id: item.key,
          label: displayVal,
          category,
          type: "bounded-context",
          position: { x: tx - 80, y: ty - 80 },
          side,
          isRoot: false,
        });

        edges.push({
          id: `edge-${item.key}`,
          source: item.key,
          target: "root-core",
          targetHandle: side,
          type: "smoothstep",
        });
      });
    },
  );

  // Category nodes rendered inside root-core as locked child nodes.
  // Positions are relative to root-core's top-left corner (0,0 = top-left of 500×500 box).
  // Placed in the lower half of the hexagon — clear of the center label.

  const categoryDefs = [
    { id: "inner-entities", label: "Entities", type: "entity" as const, items: entityItems },
    { id: "inner-usecases", label: "Use Cases", type: "use-case" as const, items: useCaseItems },
  ].filter((def) => def.items.length > 0);

  // Category nodes rendered as compact 120×36 labels inside the hexagon.
  // Base x=190 centers a 120px node at hexagon center (250px). spacing=140
  // places two nodes side by side within the safe zone of the 500px hex body.
  const categoryY = 390;
  const categorySpacing = 140;
  categoryDefs.forEach((cat, i) => {
    const offsetX = (i - (categoryDefs.length - 1) / 2) * categorySpacing;
    nodes.push({
      id: cat.id,
      label: cat.label,
      type: cat.type,
      position: { x: 190 + offsetX, y: categoryY },
      parentId: "root-core",
      extent: "parent" as const,
    });
  });

  // Individual domain nodes are placed in vertical columns directly below their
  // category node. rootBottom is the absolute bottom edge of the 500px root-core.
  const rootBottom = centerY + 250;
  const ITEM_SPACER = 85;

  // Wider spread for item columns — items are 140px wide so categorySpacing (140)
  // would make adjacent columns touch. 240 gives ~100px of breathing room.
  const itemColumnSpacing = 240;

  const domainGroups = [
    { items: entityItems, categoryId: "inner-entities", type: "entity" as const, idPrefix: "entity" },
    { items: useCaseItems, categoryId: "inner-usecases", type: "use-case" as const, idPrefix: "usecase" },
  ];

  domainGroups.forEach((group, gi) => {
    const offsetX = (gi - (categoryDefs.length - 1) / 2) * itemColumnSpacing;
    // Absolute center-x of the 120px category node: root left edge + node left + half width
    const catCenterX = (centerX - 250) + (190 + offsetX) + 60;

    group.items.forEach((label, j) => {
      const id = `${group.idPrefix}-${j}`;
      nodes.push({
        id,
        label,
        type: group.type,
        position: {
          x: catCenterX - 70,
          y: rootBottom + 30 + j * ITEM_SPACER,
        },
      });

      edges.push({
        id: `edge-${id}`,
        source: group.categoryId,
        target: id,
        type: "default",
      });
    });
  });

  return { nodes, edges };
}
