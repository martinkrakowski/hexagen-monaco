import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { WizardData } from "@hexagen/project-configuration";
import {
  HexagonalMapGeneratorAdapter,
  type HexagonNode,
} from "@hexagen/visualization";
import {
  computeAddOnOverlay,
  type AddOnMeta,
  type AddOnMetaLookup,
} from "./addon-overlay";
import {
  annotateCompassNodes,
  buildStripChips,
  placeStripChips,
  compassNodeIdFor,
  overlayContextsFrom,
  ADDON_CHIP_TYPE,
  ADDON_STRIP_LABEL_TYPE,
  type AddOnChipNode,
  type WithAddOn,
} from "./addon-overlay-nodes";

const META: Record<string, AddOnMeta> = {
  bullmq: { provides: "messaging.out-adapter", scope: "context" },
  supabase: { provides: "persistence.out-adapter", scope: "context" },
  redis: { provides: "messaging.out-adapter", scope: "context" }, // no host below
  "shared-types": { provides: "kernel.user-context", scope: "shared" },
  docker: { provides: "platform.container", scope: "project" },
};
const lookup: AddOnMetaLookup = (id) => META[id];

const addOnOf = (n: HexagonNode) => (n as WithAddOn<HexagonNode>).addOn;

describe("addon-overlay-nodes", () => {
  it("annotates the exact compass nodes the REAL generator emits (AC-2, by id)", () => {
    const wizardData = {
      boundedContexts: [
        {
          id: "orders",
          name: "Orders",
          messagingAdapter: "BullMQ",
          persistenceAdapter: "Drizzle",
          portConfiguration: { inboundPorts: [], outboundPorts: [] },
        },
      ],
      externalContexts: [],
      peerMappings: [],
      addOnsAnswers: {},
    } as unknown as WizardData;

    // Real generator output — this pins compassNodeIdFor to the id scheme.
    const { nodes } = new HexagonalMapGeneratorAdapter().execute({
      wizardData,
    });
    const contexts = overlayContextsFrom(wizardData.boundedContexts);
    const overlay = computeAddOnOverlay(
      { bullmq: {}, supabase: {} },
      lookup,
      contexts,
    );

    annotateCompassNodes(nodes, overlay, contexts);

    // Exactly the two declared compass nodes are annotated.
    assert.equal(nodes.filter(addOnOf).length, 2);

    const messaging = nodes.find(
      (n) => n.id === compassNodeIdFor("orders", "messagingAdapter", "BullMQ"),
    );
    const persistence = nodes.find(
      (n) =>
        n.id === compassNodeIdFor("orders", "persistenceAdapter", "Drizzle"),
    );
    assert.ok(messaging, "real generator emits the messaging compass node id");
    assert.ok(
      persistence,
      "real generator emits the persistence compass node id",
    );
    assert.equal(addOnOf(messaging)?.addOnId, "bullmq");
    assert.equal(addOnOf(messaging)?.kind, "context-adapter");
    assert.equal(addOnOf(persistence)?.addOnId, "supabase");
  });

  it("builds one strip chip per non-context descriptor, carrying kind + reason", () => {
    const contexts = overlayContextsFrom([
      { id: "orders" },
    ] as unknown as WizardData["boundedContexts"]);
    // docker→platform-zone(project); shared-types→shared-kernel; redis→no-host
    const overlay = computeAddOnOverlay(
      { docker: {}, "shared-types": {}, redis: {} },
      lookup,
      contexts,
    );

    assert.deepEqual(
      buildStripChips(overlay).map((c) => ({
        id: c.id,
        type: c.type,
        kind: c.addOn.kind,
        reason: c.addOn.reason,
      })),
      [
        {
          id: "addon-chip-docker",
          type: ADDON_CHIP_TYPE,
          kind: "platform-zone",
          reason: "project",
        },
        {
          id: "addon-chip-shared-types",
          type: ADDON_CHIP_TYPE,
          kind: "shared-kernel",
          reason: undefined,
        },
        {
          id: "addon-chip-redis",
          type: ADDON_CHIP_TYPE,
          kind: "platform-zone",
          reason: "no-host",
        },
      ],
    );
  });

  it("places chips below the laid-out bbox, left-aligned, with the strip label above", () => {
    const laidOut = [
      {
        id: "a",
        type: "bounded-context",
        label: "A",
        position: { x: 300, y: 100 },
      },
      { id: "b", type: "adapter", label: "B", position: { x: 900, y: 800 } },
    ] as unknown as HexagonNode[];
    const chips: AddOnChipNode[] = [
      {
        id: "addon-chip-docker",
        type: ADDON_CHIP_TYPE,
        label: "docker",
        position: { x: 0, y: 0 },
        addOn: {
          addOnId: "docker",
          capability: "platform.container",
          kind: "platform-zone",
          reason: "project",
        },
      },
    ];

    const placed = placeStripChips(laidOut, chips);
    // left edge aligns to min x; y sits below the lowest bottom
    //   bc bottom = 100 + 500 = 600; adapter bottom = 800 + 120 = 920 → max 920
    //   strip y = 920 + 140 clearance = 1060
    // [0] = "Platform add-ons" label, just above the first chip (1060 - 36)
    assert.equal(placed[0].type, ADDON_STRIP_LABEL_TYPE);
    assert.deepEqual(placed[0].position, { x: 300, y: 1024 });
    // [1] = the first chip
    assert.equal(placed[1].position.x, 300);
    assert.equal(placed[1].position.y, 1060);
  });

  it("widens a chip's slot for a longer label so it cannot overlap the next chip", () => {
    const laidOut = [
      {
        id: "a",
        type: "bounded-context",
        label: "A",
        position: { x: 0, y: 0 },
      },
    ] as unknown as HexagonNode[];
    const mkChip = (id: string, label: string): AddOnChipNode => ({
      id: `addon-chip-${id}`,
      type: ADDON_CHIP_TYPE,
      label,
      position: { x: 0, y: 0 },
      addOn: {
        addOnId: id,
        capability: "platform.container",
        kind: "platform-zone",
        reason: "project",
      },
    });

    const placed = placeStripChips(laidOut, [
      mkChip("docker", "Docker"),
      mkChip("adobe", "Adobe Firefly — Content Tagging"),
    ]).filter((n) => n.type === ADDON_CHIP_TYPE) as AddOnChipNode[];

    const [first, second] = placed;
    const firstWidth = first.style?.width ?? 0;
    // longer label → wider reserved slot
    assert.ok((second.style?.width ?? 0) > firstWidth);
    // next chip starts at/after the first chip's right edge → no overlap
    assert.ok(second.position.x >= first.position.x + firstWidth);
  });

  it("returns nothing for an empty selection", () => {
    assert.deepEqual(buildStripChips([]), []);
    assert.deepEqual(placeStripChips([], []), []);
  });
});
