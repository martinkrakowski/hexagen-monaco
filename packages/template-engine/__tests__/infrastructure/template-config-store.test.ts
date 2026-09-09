import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileSystemTemplateConfigStore } from "../../src/infrastructure/template-config-store.adapter.js";
import { InMemoryTemplateConfigStore } from "../../src/infrastructure/in-memory-template-config-store.adapter.js";
import type { TemplateConfigStorePort } from "../../src/application/ports/template-config-store.port.js";
import {
  TEMPLATE_CONFIG_FILE,
  emptyConfig,
} from "../../src/domain/template-config.js";
import type {
  TemplateConfig,
  TemplateInstallRecord,
} from "../../src/domain/template-config.js";

/**
 * First suite for the template config store — the record of which add-on
 * templates a project has (plan F-D7, lane G1).
 *
 * load() collapses an absent record (ENOENT → emptyConfig()) and a
 * present-and-empty record into the same value, so a findings query cannot
 * tell "unknown" from "no add-ons". loadState() is the three-state contract
 * that separates them: absent → unknown, present-and-empty → no add-ons,
 * present-with-entries → the list.
 */

let dir: string;
let store: FileSystemTemplateConfigStore;

const RECORD: TemplateInstallRecord = {
  installedAt: "2026-01-01T00:00:00.000Z",
  version: "1.2.3",
  answers: {},
  generatedFiles: [],
};

const POPULATED: TemplateConfig = {
  schemaVersion: "1",
  templates: { "ci-github-actions": RECORD },
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-config-"));
  store = new FileSystemTemplateConfigStore();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function projectWith(
  name: string,
  fileBody: string | null,
): Promise<string> {
  const root = path.join(dir, name);
  await fs.mkdir(root);
  if (fileBody !== null)
    await fs.writeFile(
      path.join(root, TEMPLATE_CONFIG_FILE),
      fileBody,
      "utf-8",
    );
  return root;
}

describe("FileSystemTemplateConfigStore.loadState", () => {
  it("distinguishes an absent record from a present-and-empty one", async () => {
    const absent = await projectWith("absent", null);
    const present = await projectWith(
      "present",
      JSON.stringify(emptyConfig(), null, 2),
    );

    const absentState = await store.loadState(absent);
    const presentState = await store.loadState(present);

    assert.notDeepStrictEqual(absentState, presentState);
  });

  it("reports an absent record as { state: 'absent' } — the add-on history is unknown", async () => {
    const absent = await projectWith("absent", null);

    assert.deepStrictEqual(await store.loadState(absent), { state: "absent" });
  });

  it("reports a present-and-empty record as { state: 'empty' } — known to have no add-ons", async () => {
    const present = await projectWith(
      "present",
      JSON.stringify(emptyConfig(), null, 2),
    );

    assert.deepStrictEqual(await store.loadState(present), {
      state: "empty",
    });
  });

  it("reports a present record with entries as { state: 'populated' } carrying the install records", async () => {
    const present = await projectWith(
      "present",
      JSON.stringify(POPULATED, null, 2),
    );

    assert.deepStrictEqual(await store.loadState(present), {
      state: "populated",
      config: POPULATED,
    });
  });

  it("raises a schema fault, not a read error, when the record body is null", async () => {
    const nullBody = await projectWith("null-body", "null");

    await assert.rejects(store.loadState(nullBody), (err: Error) => {
      assert.match(err.message, /not readable as a config/);
      assert.ok(!err.message.includes("Failed to read template config"));
      return true;
    });
  });

  it("raises a schema fault, not a read error, when the record has no templates map", async () => {
    const noTemplates = await projectWith(
      "no-templates",
      JSON.stringify({ schemaVersion: "1" }),
    );

    await assert.rejects(store.loadState(noTemplates), (err: Error) => {
      assert.match(err.message, /not readable as a config/);
      assert.ok(!err.message.includes("Failed to read template config"));
      return true;
    });
  });

  it("raises the wrapped read error, not a raw SyntaxError, for malformed JSON", async () => {
    const malformed = await projectWith("malformed", "{ not json");

    await assert.rejects(store.loadState(malformed), (err: Error) => {
      assert.ok(!(err instanceof SyntaxError));
      assert.match(err.message, /Failed to read template config at/);
      assert.ok(
        err.message.includes(path.join(malformed, TEMPLATE_CONFIG_FILE)),
      );
      return true;
    });
  });
});

describe("FileSystemTemplateConfigStore.load", () => {
  it("still returns an empty config when no record exists — the additive fix leaves that contract untouched", async () => {
    const absent = await projectWith("absent", null);

    assert.deepStrictEqual(await store.load(absent), emptyConfig());
  });
});

describe("FileSystemTemplateConfigStore.save", () => {
  it("round-trips an install record through save() and load()", async () => {
    await store.save(dir, POPULATED);

    assert.deepStrictEqual(await store.load(dir), POPULATED);
  });

  it("leaves no temp file behind — it writes through rename", async () => {
    await store.save(dir, emptyConfig());

    assert.deepStrictEqual(await fs.readdir(dir), [TEMPLATE_CONFIG_FILE]);
  });
});

describe("InMemoryTemplateConfigStore", () => {
  it("reports { state: 'absent' } — it holds no durable record, so the add-on history is unknown", async () => {
    const inMemory = new InMemoryTemplateConfigStore();

    assert.deepStrictEqual(await inMemory.loadState(), { state: "absent" });
  });

  it("keeps reporting absent after a save — nothing is persisted", async () => {
    const inMemory = new InMemoryTemplateConfigStore();
    const asPort: TemplateConfigStorePort = inMemory;
    await asPort.save(dir, POPULATED);

    assert.deepStrictEqual(await inMemory.loadState(), { state: "absent" });
  });
});
