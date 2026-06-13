/**
 * The schemaVersion gate through SYNC's own loader path (PR-C1, RCA #6).
 *
 * `src/loaders/manifest-merge-loader.ts` is a pure re-export of
 * @hexagen/project-configuration/server's `mergeSplitManifest` — the single
 * seam where the version gate lives. The exhaustive gate cases are pinned in
 * project-configuration's own suite; THIS case pins the wiring: every
 * `hexagen` command resolves the manifest through this import, so if the
 * re-export is ever swapped for a local loader without the gate, this is the
 * test that fails. (It exercises project-configuration's built dist, exactly
 * like the production CLI.)
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeSplitManifest } from "../../src/loaders/manifest-merge-loader.js";

describe("sync loader path carries the schemaVersion gate", () => {
  it("a future-version manifest fails with the guided message, not zod output", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sync-version-gate-"));
    try {
      const archDir = path.join(dir, ".architecture");
      await fs.mkdir(archDir, { recursive: true });
      const manifestPath = path.join(archDir, "manifest.yaml");
      await fs.writeFile(
        manifestPath,
        [
          `schemaVersion: 99`,
          `a_key_only_schema_99_knows: true`,
          `system: future-system`,
          `bounded_contexts:`,
          `  - name: billing`,
          `    type: core`,
        ].join("\n"),
        "utf-8",
      );

      await assert.rejects(
        () => mergeSplitManifest(dir, manifestPath),
        (err: Error) => {
          assert.match(
            err.message,
            /schemaVersion 99 is newer than this toolchain supports/,
          );
          assert.match(err.message, /@hexagen-monaco\/sync/);
          assert.doesNotMatch(err.message, /[Uu]nrecognized key/);
          return true;
        },
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
