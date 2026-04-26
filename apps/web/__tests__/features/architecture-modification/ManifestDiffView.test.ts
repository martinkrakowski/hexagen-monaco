import assert from "node:assert/strict";

// ─── ManifestDiffView (shape validation) ────────────────────────────────────

interface ManifestEntry {
  id: string;
  name: string;
  type: "bounded-context" | "port" | "edge";
}

interface DiffEntry extends ManifestEntry {
  change: "added" | "removed" | "unchanged";
}

function computeDiff(
  current: ManifestEntry[],
  proposed: ManifestEntry[],
): DiffEntry[] {
  const currentIds = new Set(current.map((e) => e.id));
  const proposedIds = new Set(proposed.map((e) => e.id));
  const allIds = new Set([...currentIds, ...proposedIds]);
  const currentMap = new Map(current.map((e) => [e.id, e]));
  const proposedMap = new Map(proposed.map((e) => [e.id, e]));

  const diff: DiffEntry[] = [];
  for (const id of allIds) {
    const inCurrent = currentMap.get(id);
    const inProposed = proposedMap.get(id);
    if (inCurrent && inProposed) {
      diff.push({ ...inCurrent, change: "unchanged" });
    } else if (inProposed) {
      diff.push({ ...inProposed, change: "added" });
    } else if (inCurrent) {
      diff.push({ ...inCurrent, change: "removed" });
    }
  }

  const changeOrder: Record<DiffEntry["change"], number> = {
    added: 0,
    removed: 1,
    unchanged: 2,
  };
  diff.sort((a, b) => changeOrder[a.change] - changeOrder[b.change]);
  return diff;
}

// Test 1: empty diff
{
  const diff = computeDiff([], []);
  assert.strictEqual(
    diff.length,
    0,
    "Empty current and proposed should produce empty diff",
  );
  console.log("✅ ManifestDiff test 1: empty diff - passed");
}

// Test 2: all unchanged
{
  const current: ManifestEntry[] = [
    { id: "ctx-1", name: "Orders", type: "bounded-context" },
    { id: "port-1", name: "OrderPort", type: "port" },
  ];
  const proposed: ManifestEntry[] = [...current];
  const diff = computeDiff(current, proposed);
  assert.strictEqual(diff.length, 2, "Should have 2 entries");
  assert.ok(
    diff.every((d) => d.change === "unchanged"),
    "All entries should be unchanged",
  );
  console.log("✅ ManifestDiff test 2: all unchanged - passed");
}

// Test 3: additions
{
  const current: ManifestEntry[] = [
    { id: "ctx-1", name: "Orders", type: "bounded-context" },
  ];
  const proposed: ManifestEntry[] = [
    { id: "ctx-1", name: "Orders", type: "bounded-context" },
    { id: "ctx-2", name: "Billing", type: "bounded-context" },
    { id: "edge-1", name: "Orders->Billing", type: "edge" },
  ];
  const diff = computeDiff(current, proposed);
  const added = diff.filter((d) => d.change === "added");
  const unchanged = diff.filter((d) => d.change === "unchanged");
  assert.strictEqual(added.length, 2, "Should have 2 additions");
  assert.strictEqual(unchanged.length, 1, "Should have 1 unchanged");
  assert.ok(
    added.some((d) => d.name === "Billing"),
    "Billing should be added",
  );
  assert.ok(
    added.some((d) => d.name === "Orders->Billing"),
    "Edge should be added",
  );
  console.log("✅ ManifestDiff test 3: additions - passed");
}

// Test 4: removals
{
  const current: ManifestEntry[] = [
    { id: "ctx-1", name: "Orders", type: "bounded-context" },
    { id: "port-1", name: "OrderPort", type: "port" },
  ];
  const proposed: ManifestEntry[] = [
    { id: "ctx-1", name: "Orders", type: "bounded-context" },
  ];
  const diff = computeDiff(current, proposed);
  const removed = diff.filter((d) => d.change === "removed");
  assert.strictEqual(removed.length, 1, "Should have 1 removal");
  assert.strictEqual(
    removed[0].name,
    "OrderPort",
    "OrderPort should be removed",
  );
  console.log("✅ ManifestDiff test 4: removals - passed");
}

// Test 5: sort order (added before removed before unchanged)
{
  const current: ManifestEntry[] = [
    { id: "ctx-1", name: "Orders", type: "bounded-context" },
    { id: "port-1", name: "OrderPort", type: "port" },
  ];
  const proposed: ManifestEntry[] = [
    { id: "ctx-1", name: "Orders", type: "bounded-context" },
    { id: "ctx-2", name: "Billing", type: "bounded-context" },
  ];
  const diff = computeDiff(current, proposed);
  const changes = diff.map((d) => d.change);
  const addedIdx = changes.indexOf("added");
  const removedIdx = changes.indexOf("removed");
  const unchangedIdx = changes.indexOf("unchanged");
  assert.ok(addedIdx < unchangedIdx, "Added should come before unchanged");
  assert.ok(removedIdx < unchangedIdx, "Removed should come before unchanged");
  console.log("✅ ManifestDiff test 5: sort order - passed");
}

// Test 6: manifest entry types
{
  const entry: ManifestEntry = {
    id: "ctx-1",
    name: "Billing",
    type: "bounded-context",
  };
  assert.ok(
    ["bounded-context", "port", "edge"].includes(entry.type),
    "Type should be valid",
  );
  console.log("✅ ManifestDiff test 6: entry types - passed");
}

console.log("✅ All ManifestDiffView tests passed.");
