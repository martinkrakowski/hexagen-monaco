import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileSystemTemplateConfigStore } from "../../src/infrastructure/template-config-store.adapter.js";
import {
  TEMPLATE_CONFIG_FILE,
  emptyConfig,
} from "../../src/domain/template-config.js";

/**
 * RED for the three-state contract (plan F-D7, lane G1).
 *
 * load() returns emptyConfig() on ENOENT, so an absent record and a
 * present-and-empty record collapse into the same value and a findings
 * query cannot tell "unknown" from "no add-ons". This test pins the
 * distinction; it can only pass once the store has a way to report it.
 */

let dir: string;
let store: FileSystemTemplateConfigStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-config-"));
  store = new FileSystemTemplateConfigStore();
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("FileSystemTemplateConfigStore.loadState", () => {
  it("distinguishes an absent record from a present-and-empty one", async () => {
    const absent = path.join(dir, "absent");
    const present = path.join(dir, "present");
    await fs.mkdir(absent);
    await fs.mkdir(present);
    await fs.writeFile(
      path.join(present, TEMPLATE_CONFIG_FILE),
      JSON.stringify(emptyConfig(), null, 2),
      "utf-8",
    );

    const absentState = await store.loadState(absent);
    const presentState = await store.loadState(present);

    assert.notDeepStrictEqual(absentState, presentState);
  });
});
