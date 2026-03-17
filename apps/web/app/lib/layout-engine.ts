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

  // Central root node — 400px component, centered at (centerX, centerY)
  nodes.push({
    id: "root-core",
    label: wizardData.rootName?.trim() || "Project Root",
    type: "bounded-context",
    position: { x: centerX - 200, y: centerY - 200 },
    isRoot: true,
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
  // Positions are relative to root-core's top-left corner (0,0 = top-left of 400×400 box).
  // Placed in the lower half of the hexagon — clear of the center label.
  const entityItems = (wizardData.entities ?? []).filter(Boolean);
  const useCaseItems = (wizardData.useCases ?? []).filter(Boolean);

  const categoryDefs = [
    { id: "inner-entities", label: "Entities", type: "entity" as const, items: entityItems },
    { id: "inner-usecases", label: "Use Cases", type: "use-case" as const, items: useCaseItems },
  ].filter((def) => def.items.length > 0);

  // Category nodes rendered as compact 120×36 labels inside the hexagon.
  // Base x=140 centers a 120px node at hexagon center (200px). spacing=130
  // places two nodes side by side within the safe zone (SVG y ≤ 72.5).
  const categoryY = 252;
  const categorySpacing = 130;
  categoryDefs.forEach((cat, i) => {
    const offsetX = (i - (categoryDefs.length - 1) / 2) * categorySpacing;
    nodes.push({
      id: cat.id,
      label: cat.label,
      type: cat.type,
      position: { x: 140 + offsetX, y: categoryY },
      parentId: "root-core",
      extent: "parent" as const,
    });
  });

  // Individual domain nodes orbit root-core at innerRadius.
  // Each connects to its category node inside the hexagon.
  const innerRadius = 340;
  const allDomainItems = [
    ...entityItems.map((label, i) => ({ id: `entity-${i}`, label, type: "entity" as const, categoryId: "inner-entities" })),
    ...useCaseItems.map((label, i) => ({ id: `usecase-${i}`, label, type: "use-case" as const, categoryId: "inner-usecases" })),
  ];

  allDomainItems.forEach((dn, i) => {
    const angle = (2 * Math.PI * i) / allDomainItems.length - Math.PI / 2;
    nodes.push({
      id: dn.id,
      label: dn.label,
      type: dn.type,
      position: {
        x: centerX + Math.cos(angle) * innerRadius - 70,
        y: centerY + Math.sin(angle) * innerRadius - 36,
      },
    });

    edges.push({
      id: `edge-${dn.id}`,
      source: dn.categoryId,
      target: dn.id,
      type: "default",
    });
  });

  return { nodes, edges };
}
