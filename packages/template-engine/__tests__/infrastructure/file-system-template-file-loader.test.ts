import { describe, it } from "vitest";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFileSystemTemplateFileLoader } from "../../src/infrastructure/file-system-template-file-loader.js";

const TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
);
const load = createFileSystemTemplateFileLoader(TEMPLATES_DIR);

describe("createFileSystemTemplateFileLoader", () => {
  it("returns null for a missing source file (ENOENT)", async () => {
    assert.equal(await load("rate-limiting", "does/not/exist.ts"), null);
  });

  it("rejects a relPath that escapes the template's files/ dir", async () => {
    await assert.rejects(
      () => load("rate-limiting", "../../../etc/passwd"),
      /escapes the template directory/,
    );
    await assert.rejects(
      () => load("rate-limiting", "/etc/passwd"),
      /escapes the template directory/,
    );
  });
});
