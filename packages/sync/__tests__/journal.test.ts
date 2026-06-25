/**
 * SyncJournal unit tests (PR-B1, RCA #4) — the inverse-op replay that
 * replaced the engine's git-wide reset/clean. Engine-level wiring is pinned
 * in integration/sync-engine-errors-selfregen.test.ts; the dist-level
 * behaviour (including the untracked-file survival differential) in
 * contract/rollback.contract.test.ts.
 */
import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SyncJournal } from "../src/journal.js";
import { silentLogger } from "./helpers/test-config.js";
import { pathExists } from "./helpers/fs-helpers.js";

describe("SyncJournal (PR-B1, RCA #4)", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-journal-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("derives entry kinds from the pre-image and reports them oldest-first", () => {
    const journal = new SyncJournal();
    journal.recordWrite(path.join(root, "a.ts"), null);
    journal.recordWrite(path.join(root, "b.ts"), "old b");
    journal.recordDelete(path.join(root, "c.ts"), "old c");

    assert.equal(journal.size, 3);
    assert.deepEqual(journal.describeEntries(root), [
      "created a.ts",
      "overwritten b.ts",
      "deleted c.ts",
    ]);
  });

  it("rollback unlinks created files and restores pre-images byte-identically", async () => {
    const created = path.join(root, "pkg", "new.ts");
    const overwritten = path.join(root, "pkg", "changed.ts");
    const deleted = path.join(root, "pkg", "gone.ts");

    const journal = new SyncJournal();
    journal.recordWrite(created, null);
    journal.recordWrite(overwritten, "original content\n");
    journal.recordDelete(deleted, "deleted content\n");

    // Simulate what sync did after recording.
    await fs.mkdir(path.dirname(created), { recursive: true });
    await fs.writeFile(created, "generated\n");
    await fs.writeFile(overwritten, "clobbered\n");
    // `deleted` is absent — the unlink happened.

    const outcome = await journal.rollback(silentLogger, root);

    assert.deepEqual(outcome, { attempted: 3, restored: 3, failures: [] });
    assert.equal(
      await pathExists(created),
      false,
      "created file must be removed",
    );
    assert.equal(await fs.readFile(overwritten, "utf8"), "original content\n");
    assert.equal(await fs.readFile(deleted, "utf8"), "deleted content\n");
  });

  it("replays in REVERSE so repeated writes to one path converge on the oldest pre-image", async () => {
    const target = path.join(root, "barrel.ts");
    await fs.writeFile(target, "pass-2 output\n");

    const journal = new SyncJournal();
    // Pass 1 saw the true pre-sync content; pass 2 saw pass 1's output.
    journal.recordWrite(target, "pre-sync content\n");
    journal.recordWrite(target, "pass-1 output\n");

    const outcome = await journal.rollback(silentLogger, root);

    assert.equal(outcome.failures.length, 0);
    assert.equal(
      await fs.readFile(target, "utf8"),
      "pre-sync content\n",
      "reverse replay must end on the OLDEST pre-image (true pre-sync state)",
    );
  });

  it("tolerates ENOENT when removing a created file that was journaled but never written", async () => {
    // record-first means a write can be journaled and then fail before
    // landing — rolling that back must not be an error.
    const never = path.join(root, "never-written.ts");
    const journal = new SyncJournal();
    journal.recordWrite(never, null);

    const outcome = await journal.rollback(silentLogger, root);

    assert.deepEqual(outcome, { attempted: 1, restored: 1, failures: [] });
  });

  it("recreates missing parent directories when restoring a pre-image", async () => {
    const nested = path.join(root, "deep", "nested", "file.ts");
    const journal = new SyncJournal();
    journal.recordDelete(nested, "buried treasure\n");
    // Parent directories never existed (or were removed since).

    const outcome = await journal.rollback(silentLogger, root);

    assert.equal(outcome.failures.length, 0);
    assert.equal(await fs.readFile(nested, "utf8"), "buried treasure\n");
  });

  it("is best-effort: one failing inverse op is collected and the rest still restore — never a git fallback", async () => {
    const blocked = path.join(root, "obstacle", "victim.ts");
    const fine = path.join(root, "fine.ts");

    const journal = new SyncJournal();
    journal.recordWrite(blocked, "cannot come back\n");
    journal.recordWrite(fine, "restorable\n");

    // Make the first restore impossible: its parent path component is a FILE,
    // so mkdir recursive fails ENOTDIR deterministically on POSIX.
    await fs.writeFile(path.join(root, "obstacle"), "i am a file");
    await fs.writeFile(fine, "clobbered\n");

    const outcome = await journal.rollback(silentLogger, root);

    assert.equal(outcome.attempted, 2);
    assert.equal(outcome.restored, 1, "the healthy entry must still restore");
    assert.equal(outcome.failures.length, 1);
    assert.equal(outcome.failures[0].path, blocked);
    assert.equal(outcome.failures[0].intended, "restore pre-image");
    assert.ok(
      outcome.failures[0].error.length > 0,
      "failure carries the error",
    );
    assert.equal(
      await fs.readFile(fine, "utf8"),
      "restorable\n",
      "replay must continue past the failure",
    );
  });
});
