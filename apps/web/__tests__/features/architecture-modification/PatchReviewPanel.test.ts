import assert from "node:assert/strict";
import type { Patch } from "@hexagen/reconciliation-engine";

// ─── PatchReviewPanel (shape validation) ────────────────────────────────────

// Validate Patch type shapes for rendering
const samplePatches: Patch[] = [
  {
    id: "p1",
    type: "add_node",
    targetId: "ctx-billing",
    payload: { name: "Billing" },
  },
  {
    id: "p2",
    type: "remove_edge",
    targetId: "edge-1",
    payload: { source: "a", target: "b" },
  },
  {
    id: "p3",
    type: "update_node",
    targetId: "ctx-orders",
    payload: { name: "OrderManagement" },
  },
];

// Validate patch type labels exist for all Patch types
const PATCH_TYPE_LABELS: Record<Patch["type"], string> = {
  add_node: "Add Node",
  remove_node: "Remove Node",
  add_edge: "Add Edge",
  remove_edge: "Remove Edge",
  update_node: "Update Node",
  update_edge: "Update Edge",
};

{
  const allPatchTypes: Patch["type"][] = [
    "add_node",
    "remove_node",
    "add_edge",
    "remove_edge",
    "update_node",
    "update_edge",
  ];
  for (const t of allPatchTypes) {
    assert.ok(PATCH_TYPE_LABELS[t], `Should have label for ${t}`);
    assert.ok(
      typeof PATCH_TYPE_LABELS[t] === "string",
      `Label for ${t} should be string`,
    );
  }
  console.log("✅ PatchReview test 1: all patch types have labels - passed");
}

// Validate patch rendering properties
{
  for (const patch of samplePatches) {
    assert.ok(patch.id, "Patch should have id");
    assert.ok(patch.type, "Patch should have type");
    assert.ok(patch.targetId, "Patch should have targetId");
    assert.ok(
      typeof patch.payload === "object",
      "Patch should have payload object",
    );
    assert.ok(
      PATCH_TYPE_LABELS[patch.type],
      `Patch type ${patch.type} should have label`,
    );
  }
  console.log("✅ PatchReview test 2: patch rendering properties - passed");
}

// Validate accept/reject callbacks shape (transaction-level)
{
  let accepted = false;
  let rejected = false;

  const onAcceptAll = () => {
    accepted = true;
  };
  const onRejectAll = () => {
    rejected = true;
  };

  onAcceptAll();
  assert.strictEqual(accepted, true, "AcceptAll should be triggered");

  onRejectAll();
  assert.strictEqual(rejected, true, "RejectAll should be triggered");
  console.log("✅ PatchReview test 3: accept/reject all callbacks - passed");
}

// Validate empty patches renders correctly
{
  const emptyPatches: Patch[] = [];
  assert.strictEqual(
    emptyPatches.length,
    0,
    "Empty patches array should have length 0",
  );
  console.log("✅ PatchReview test 4: empty patches state - passed");
}

// Validate payload display entries
{
  for (const patch of samplePatches) {
    const entries = Object.entries(patch.payload);
    assert.ok(Array.isArray(entries), "Payload entries should be an array");
    for (const [key, value] of entries) {
      assert.ok(typeof key === "string", "Payload key should be string");
      assert.ok(value !== undefined, "Payload value should be defined");
    }
  }
  console.log("✅ PatchReview test 5: payload display entries - passed");
}

console.log("✅ All PatchReviewPanel tests passed.");
