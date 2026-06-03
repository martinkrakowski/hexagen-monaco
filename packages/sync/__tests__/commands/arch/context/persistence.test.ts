import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { promises as fs } from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Manifest } from "@hexagen/sync";
import {
  addContextToManifest,
  checkContextUniqueness,
  generateManifestYaml,
  loadManifest,
  saveManifest,
  validateContextName,
} from "../../../../src/commands/arch/context/persistence.js";

/**
 * Unit tests for packages/sync/src/commands/arch/context/persistence.ts.
 *
 * Scope: the pure (and file-system) functions that back the `arch add context`
 * command. The interactive wizard (wizard.ts) and the commander shell
 * (command.ts) are deliberately not exercised here — their only non-trivial
 * logic lives inside these persistence primitives.
 *
 * Functions under test:
 *   - addContextToManifest    (pure transformation)
 *   - validateContextName     (pure validation)
 *   - checkContextUniqueness  (pure validation against manifest)
 *   - generateManifestYaml    (pure serialisation)
 *   - loadManifest            (disk I/O → Result)
 *   - saveManifest            (disk I/O → Result; atomic write via temp file)
 *
 * Tests use temp directories for loadManifest/saveManifest (mirrors
 * fs-utils.test.ts style).
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeEmptyManifest(): Manifest {
  return {
    system: "test-system",
    architecture: "modular-monolith",
    bounded_contexts: [],
  } as Manifest;
}

function makeManifestWithContexts(): Manifest {
  return {
    system: "test-system",
    architecture: "modular-monolith",
    bounded_contexts: [
      {
        name: "users",
        type: "core",
        description: "User management",
      },
      {
        name: "orders",
        type: "supporting",
      },
    ],
  } as Manifest;
}

// ---------------------------------------------------------------------------
// addContextToManifest — pure transformation
// ---------------------------------------------------------------------------

describe("addContextToManifest", () => {
  it("appends a new context to an empty manifest", () => {
    const manifest = makeEmptyManifest();

    const updated = addContextToManifest(
      manifest,
      "billing",
      "core",
      "Handles invoices",
    );

    assert.equal(updated.bounded_contexts?.length, 1);
    const added = updated.bounded_contexts?.[0];
    assert.equal(added?.name, "billing");
    assert.equal(added?.type, "core");
    assert.equal(added?.description, "Handles invoices");
  });

  it("appends to an existing list without mutating the input", () => {
    const manifest = makeManifestWithContexts();
    const originalLength = manifest.bounded_contexts!.length;
    const originalSnapshot = JSON.stringify(manifest);

    const updated = addContextToManifest(manifest, "billing", "supporting");

    assert.equal(updated.bounded_contexts?.length, originalLength + 1);
    assert.equal(
      JSON.stringify(manifest),
      originalSnapshot,
      "input must not be mutated",
    );
  });

  it("preserves pre-existing contexts verbatim", () => {
    const manifest = makeManifestWithContexts();

    const updated = addContextToManifest(manifest, "billing", "core");

    // Original contexts appear first, in order, unchanged
    assert.equal(updated.bounded_contexts?.[0].name, "users");
    assert.equal(updated.bounded_contexts?.[1].name, "orders");
    assert.equal(updated.bounded_contexts?.[2].name, "billing");
  });

  it("defaults type to 'core' when omitted", () => {
    const manifest = makeEmptyManifest();

    // Call without the type argument (exercises default parameter)
    const updated = addContextToManifest(manifest, "defaults-context");

    assert.equal(updated.bounded_contexts?.[0].type, "core");
  });

  it("omits the description field entirely when not provided", () => {
    const manifest = makeEmptyManifest();

    const updated = addContextToManifest(manifest, "no-desc", "driver");
    const added = updated.bounded_contexts?.[0];

    assert.ok(added !== undefined);
    assert.equal(added.name, "no-desc");
    assert.equal(added.type, "driver");
    // Key should not be present at all, not just undefined
    assert.equal(
      Object.prototype.hasOwnProperty.call(added, "description"),
      false,
      "description should not be set when not provided",
    );
  });

  it("omits description when explicitly passed undefined", () => {
    const manifest = makeEmptyManifest();

    const updated = addContextToManifest(manifest, "x", "core", undefined);
    const added = updated.bounded_contexts?.[0];

    assert.equal(
      Object.prototype.hasOwnProperty.call(added, "description"),
      false,
    );
  });

  it("accepts all five declared context types", () => {
    let manifest = makeEmptyManifest();

    for (const t of [
      "core",
      "supporting",
      "generic",
      "shared-kernel",
      "driver",
    ] as const) {
      manifest = addContextToManifest(manifest, `ctx-${t}`, t);
    }

    assert.deepEqual(
      manifest.bounded_contexts?.map((c) => c.type),
      ["core", "supporting", "generic", "shared-kernel", "driver"],
    );
  });

  it("handles a manifest without a bounded_contexts field by starting fresh", () => {
    // Simulate a partially-constructed manifest where bounded_contexts is absent.
    const manifest = {
      system: "test-system",
      architecture: "modular-monolith",
    } as Manifest;

    const updated = addContextToManifest(manifest, "first", "core");

    assert.equal(updated.bounded_contexts?.length, 1);
    assert.equal(updated.bounded_contexts?.[0].name, "first");
  });

  it("does NOT detect duplicates (pure append semantics)", () => {
    // Intentional: duplicate prevention is the responsibility of
    // checkContextUniqueness, which the caller must invoke first.
    // This test documents that contract so a future refactor doesn't
    // silently change it.
    const manifest = makeManifestWithContexts();

    const updated = addContextToManifest(manifest, "users", "core");

    assert.equal(updated.bounded_contexts?.length, 3);
    const users = updated.bounded_contexts?.filter((c) => c.name === "users");
    assert.equal(users?.length, 2, "duplicate is appended blindly");
  });
});

// ---------------------------------------------------------------------------
// validateContextName — pure validation
// ---------------------------------------------------------------------------

describe("validateContextName", () => {
  it("accepts a simple snake_case-with-hyphens name", () => {
    // NOTE: the function's regex actually allows kebab-case (hyphens), not
    // underscore snake_case, despite the error message saying 'snake_case'.
    // Tests reflect observed behaviour, not the message.
    const result = validateContextName("user-management");

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("accepts a single lowercase word", () => {
    const result = validateContextName("users");

    assert.equal(result.valid, true);
  });

  it("accepts lowercase alphanumeric", () => {
    const result = validateContextName("api2");

    assert.equal(result.valid, true);
  });

  it("rejects PascalCase", () => {
    const result = validateContextName("UserManagement");

    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((e) => e.includes("snake_case")),
      "expected a snake_case error",
    );
  });

  it("rejects names starting with a digit", () => {
    const result = validateContextName("1-context");

    assert.equal(result.valid, false);
  });

  it("rejects names containing underscores (kebab-only regex)", () => {
    // Documents current regex behaviour: the source says snake_case but
    // the regex is ^[a-z][a-z0-9]*(-[a-z0-9]+)*$ which forbids underscores.
    const result = validateContextName("user_management");

    assert.equal(result.valid, false);
  });

  it("rejects names shorter than 3 characters", () => {
    const result = validateContextName("ab");

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("at least 3")));
  });

  it("rejects names longer than 50 characters", () => {
    const result = validateContextName("a".repeat(51));

    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("less than 50")));
  });

  it("accepts exactly 50-character names (boundary)", () => {
    const name = "a" + "b".repeat(49); // 50 chars, valid pattern
    const result = validateContextName(name);

    assert.equal(result.valid, true);
  });

  it("rejects each reserved name", () => {
    for (const reserved of ["shared", "core", "root", "system"]) {
      const result = validateContextName(reserved);
      assert.equal(
        result.valid,
        false,
        `expected '${reserved}' to be rejected`,
      );
      assert.ok(
        result.errors.some((e) => e.includes("reserved")),
        `expected a reserved-name error for '${reserved}'`,
      );
    }
  });

  it("reserved-name check is case-insensitive", () => {
    const result = validateContextName("SHARED");

    assert.equal(result.valid, false);
    // "SHARED" also fails the snake_case regex; both errors may appear.
    assert.ok(result.errors.some((e) => e.includes("reserved")));
  });

  it("accumulates multiple errors for a single bad name", () => {
    // "AB" = PascalCase + too short → two errors
    const result = validateContextName("AB");

    assert.equal(result.valid, false);
    assert.ok(
      result.errors.length >= 2,
      `expected >= 2 errors, got ${result.errors.length}`,
    );
  });
});

// ---------------------------------------------------------------------------
// checkContextUniqueness — pure validation against manifest
// ---------------------------------------------------------------------------

describe("checkContextUniqueness", () => {
  it("returns valid=true for a name not in the manifest", () => {
    const manifest = makeManifestWithContexts();

    const result = checkContextUniqueness("billing", manifest);

    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("returns valid=false for a duplicate name", () => {
    const manifest = makeManifestWithContexts();

    const result = checkContextUniqueness("users", manifest);

    assert.equal(result.valid, false);
    assert.ok(result.errors[0].includes("already exists"));
    assert.ok(result.errors[0].includes("users"));
  });

  it("treats name match as case-sensitive", () => {
    const manifest = makeManifestWithContexts();

    const result = checkContextUniqueness("USERS", manifest);

    assert.equal(
      result.valid,
      true,
      "uppercase 'USERS' should not collide with 'users'",
    );
  });

  it("returns valid=true for any name when manifest has no contexts", () => {
    const manifest = makeEmptyManifest();

    const result = checkContextUniqueness("anything", manifest);

    assert.equal(result.valid, true);
  });

  it("returns valid=true when bounded_contexts field is absent", () => {
    const manifest = {
      system: "test",
      architecture: "modular-monolith",
    } as Manifest;

    const result = checkContextUniqueness("anything", manifest);

    assert.equal(result.valid, true);
  });
});

// ---------------------------------------------------------------------------
// generateManifestYaml — pure serialisation
// ---------------------------------------------------------------------------

describe("generateManifestYaml", () => {
  it("produces a string containing each context name", () => {
    const manifest = makeManifestWithContexts();

    const yaml = generateManifestYaml(manifest);

    assert.equal(typeof yaml, "string");
    assert.ok(yaml.includes("users"));
    assert.ok(yaml.includes("orders"));
  });

  it("includes the system and architecture top-level keys", () => {
    const manifest = makeManifestWithContexts();

    const yaml = generateManifestYaml(manifest);

    assert.ok(yaml.includes("system:"));
    assert.ok(yaml.includes("architecture:"));
  });

  it("round-trips through addContextToManifest then serialisation", () => {
    const manifest = addContextToManifest(
      makeEmptyManifest(),
      "payments",
      "core",
      "Handles card charges",
    );

    const yaml = generateManifestYaml(manifest);

    assert.ok(yaml.includes("payments"));
    assert.ok(yaml.includes("Handles card charges"));
  });
});

// ---------------------------------------------------------------------------
// loadManifest + saveManifest — disk I/O, Result-shaped
// ---------------------------------------------------------------------------

describe("saveManifest / loadManifest (atomic file I/O)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), "hexagen-ctx-persistence-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saveManifest creates .architecture/manifest.yaml and returns success", async () => {
    const manifest = addContextToManifest(
      makeEmptyManifest(),
      "billing",
      "core",
    );

    const result = saveManifest(tmpDir, manifest);

    assert.equal(result.success, true);
    assert.equal(result.error, undefined);

    const written = await fs.readFile(
      path.join(tmpDir, ".architecture", "manifest.yaml"),
      "utf-8",
    );
    assert.ok(written.includes("billing"));
  });

  it("saveManifest creates the .architecture directory on demand", async () => {
    const manifest = makeEmptyManifest();

    // .architecture does NOT exist yet — saveManifest must create it.
    await assert.rejects(fs.stat(path.join(tmpDir, ".architecture")));

    const result = saveManifest(tmpDir, manifest);

    assert.equal(result.success, true);
    const stat = await fs.stat(path.join(tmpDir, ".architecture"));
    assert.ok(stat.isDirectory());
  });

  it("saveManifest does not leave a .tmp file on success", async () => {
    const manifest = addContextToManifest(makeEmptyManifest(), "foo", "core");

    saveManifest(tmpDir, manifest);

    const entries = await fs.readdir(path.join(tmpDir, ".architecture"));
    assert.deepEqual(
      entries.filter((e) => e.endsWith(".tmp")),
      [],
      "no stale .tmp artifact expected",
    );
  });

  it("saveManifest returns Result with error when target dir cannot be created", () => {
    // Point saveManifest at a path whose parent is a regular file, so mkdir
    // -p will fail deterministically.
    const blockedRoot = path.join(tmpDir, "blocked");
    // Make `blockedRoot` a regular file so mkdir -p on its child fails.
    writeFileSync(blockedRoot, "not-a-dir");

    const result = saveManifest(blockedRoot, makeEmptyManifest());

    assert.equal(result.success, false);
    assert.ok(result.error instanceof Error);
    assert.ok(
      result.error!.message.includes("Failed to"),
      `expected a 'Failed to...' error, got: ${result.error!.message}`,
    );
  });

  it("loadManifest reads back what saveManifest wrote (round-trip)", async () => {
    const manifest = addContextToManifest(
      makeEmptyManifest(),
      "users",
      "core",
      "User management",
    );

    const saveResult = saveManifest(tmpDir, manifest);
    assert.equal(saveResult.success, true);

    const loadResult = await loadManifest(tmpDir);
    assert.equal(loadResult.success, true);
    if (!loadResult.success) return;

    const contexts = loadResult.data.bounded_contexts ?? [];
    assert.equal(contexts.length, 1);
    assert.equal(contexts[0].name, "users");
    assert.equal(contexts[0].type, "core");
    assert.equal(contexts[0].description, "User management");
  });

  it("loadManifest returns Result.error for a missing manifest", async () => {
    const result = await loadManifest(tmpDir);

    assert.equal(result.success, false);
    if (result.success) return;
    assert.ok(result.error instanceof Error);
  });

  it("loadManifest returns Result.error for invalid YAML content", async () => {
    await fs.mkdir(path.join(tmpDir, ".architecture"), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, ".architecture", "manifest.yaml"),
      "system: test\n  bad: indent:\n: :",
      "utf-8",
    );

    const result = await loadManifest(tmpDir);

    assert.equal(result.success, false);
  });

  it("saveManifest → loadManifest preserves multiple contexts in order", async () => {
    let manifest = makeEmptyManifest();
    manifest = addContextToManifest(manifest, "ctx-a", "core");
    manifest = addContextToManifest(manifest, "ctx-b", "supporting");
    manifest = addContextToManifest(manifest, "ctx-c", "shared-kernel");
    manifest = addContextToManifest(manifest, "ctx-d", "generic");

    assert.equal(saveManifest(tmpDir, manifest).success, true);

    const loaded = await loadManifest(tmpDir);
    assert.equal(loaded.success, true);
    if (!loaded.success) return;

    assert.deepEqual(
      loaded.data.bounded_contexts?.map((c) => c.name),
      ["ctx-a", "ctx-b", "ctx-c", "ctx-d"],
    );
    assert.deepEqual(
      loaded.data.bounded_contexts?.map((c) => c.type),
      ["core", "supporting", "shared-kernel", "generic"],
    );
  });

  it("saveManifest is atomic: second write overwrites cleanly", async () => {
    // First save.
    let manifest = addContextToManifest(makeEmptyManifest(), "v1", "core");
    assert.equal(saveManifest(tmpDir, manifest).success, true);

    // Second save — different content.
    manifest = addContextToManifest(makeEmptyManifest(), "v2", "driver");
    assert.equal(saveManifest(tmpDir, manifest).success, true);

    const loaded = await loadManifest(tmpDir);
    assert.equal(loaded.success, true);
    if (!loaded.success) return;
    assert.equal(loaded.data.bounded_contexts?.length, 1);
    assert.equal(loaded.data.bounded_contexts?.[0].name, "v2");
  });
});
