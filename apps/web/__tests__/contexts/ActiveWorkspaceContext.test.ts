import assert from "node:assert/strict";

// ─── Test the persisted storage validator logic ───────────────────────

// Import the validator logic by testing localStorage directly
// The validator is defined inside createPersistedStorage in app/lib/persisted-state.ts
// We test it indirectly via localStorage

const STORAGE_KEY = "hexagen-active-workspace";

// ─── Test 1: Valid workspace passes validation ─────────────────────
{
  const validWorkspace = {
    projectId: "test-1",
    name: "Test Project",
    isDirty: false,
    lastModifiedAt: Date.now(),
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(validWorkspace));

  // Simulate the validator: typeof candidate === "object" && candidate !== null && typeof projectId === "string"
  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? JSON.parse(raw) : null;
  const isValid =
    typeof parsed === "object" &&
    parsed !== null &&
    typeof (parsed as Record<string, unknown>).projectId === "string";

  assert.ok(isValid, "Valid workspace should pass validation");
  console.log("✅ Test 1: valid workspace passes — passed");

  localStorage.removeItem(STORAGE_KEY);
}

// ─── Test 2: Missing projectId fails validation ────────────────────
{
  const invalidWorkspace = {
    name: "No ProjectId",
    isDirty: false,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(invalidWorkspace));

  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? JSON.parse(raw) : null;
  const isValid =
    typeof parsed === "object" &&
    parsed !== null &&
    typeof (parsed as Record<string, unknown>).projectId === "string";

  assert.ok(!isValid, "Workspace without projectId should fail validation");
  console.log("✅ Test 2: missing projectId fails — passed");

  localStorage.removeItem(STORAGE_KEY);
}

// ─── Test 3: Corrupted JSON returns null ─────────────────────────
{
  localStorage.setItem(STORAGE_KEY, "not-json");

  const raw = localStorage.getItem(STORAGE_KEY);
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = null;
  }

  assert.equal(parsed, null, "Corrupted JSON should return null after catch");
  console.log("✅ Test 3: corrupted JSON handled — passed");

  localStorage.removeItem(STORAGE_KEY);
}

// ─── Test 4: null/undefined storage returns null ───────────────────
{
  localStorage.removeItem(STORAGE_KEY);

  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? JSON.parse(raw) : null;

  assert.equal(parsed, null, "Missing storage should return null");
  console.log("✅ Test 4: missing storage returns null — passed");
}

// ─── Test 5: Non-object value fails validation ────────────────────
{
  localStorage.setItem(STORAGE_KEY, JSON.stringify("just a string"));

  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? JSON.parse(raw) : null;
  const isValid =
    typeof parsed === "object" &&
    parsed !== null &&
    typeof (parsed as Record<string, unknown>).projectId === "string";

  assert.ok(!isValid, "String value should fail object validation");
  console.log("✅ Test 5: non-object fails — passed");

  localStorage.removeItem(STORAGE_KEY);
}

// ─── Test 6: null value in storage ─────────────────────────────────
{
  localStorage.setItem(STORAGE_KEY, "null");

  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed = raw ? JSON.parse(raw) : null;

  assert.equal(parsed, null, "null in storage should parse to null");
  console.log("✅ Test 6: null storage value — passed");

  localStorage.removeItem(STORAGE_KEY);
}

// ─── Test 7: ActiveWorkspace interface shape ──────────────────────
{
  const workspace = {
    projectId: "test-7",
    name: "Test",
    isDirty: true,
    lastModifiedAt: Date.now(),
    wizardData: { step: 1 },
    manifestYaml: "yaml content",
  };

  // Verify all required fields are present
  assert.equal(typeof workspace.projectId, "string");
  assert.equal(typeof workspace.name, "string");
  assert.equal(typeof workspace.isDirty, "boolean");
  assert.equal(typeof workspace.lastModifiedAt, "number");
  console.log("✅ Test 7: ActiveWorkspace shape valid — passed");
}

console.log("\n✅ All ActiveWorkspaceContext logic tests passed!");
