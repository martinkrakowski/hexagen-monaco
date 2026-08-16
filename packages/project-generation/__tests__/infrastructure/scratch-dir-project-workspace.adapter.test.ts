import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { ScratchDirProjectWorkspaceAdapter } from "../../src/infrastructure/adapters/scratch-dir-project-workspace.adapter.js";

/**
 * The production binding of `ProjectWorkspacePort`. The symlink defence tested
 * here is the one that used to sit inline in `GenerateProjectUseCase` with no
 * coverage at all — it is a filesystem capability, so it moved to the adapter
 * (containment policy stayed in the application layer).
 */
describe("ScratchDirProjectWorkspaceAdapter", () => {
  it("writes nested files under the workspace reference and reads them back", async () => {
    const workspace = await new ScratchDirProjectWorkspaceAdapter().open();
    try {
      await workspace.writeText(["src", "nested", "feature.ts"], "export {};");

      // The reference is a real directory the generator/exporter can walk.
      const onDisk = await fs.readFile(
        path.join(workspace.reference, "src/nested/feature.ts"),
        "utf-8",
      );
      assert.equal(onDisk, "export {};");

      const bytes = await workspace.readBytes(["src", "nested", "feature.ts"]);
      assert.equal(new TextDecoder().decode(bytes), "export {};");
    } finally {
      await workspace.release();
    }
  });

  it("resolves undefined for an entry that does not exist", async () => {
    const workspace = await new ScratchDirProjectWorkspaceAdapter().open();
    try {
      assert.equal(await workspace.readBytes(["project.zip"]), undefined);
    } finally {
      await workspace.release();
    }
  });

  it("allocates a distinct workspace per open", async () => {
    const provider = new ScratchDirProjectWorkspaceAdapter();
    const first = await provider.open();
    const second = await provider.open();
    try {
      assert.notEqual(first.reference, second.reference);
    } finally {
      await first.release();
      await second.release();
    }
  });

  it("removes the workspace on release", async () => {
    const workspace = await new ScratchDirProjectWorkspaceAdapter().open();
    await workspace.writeText(["README.md"], "# hi");
    await workspace.release();

    await assert.rejects(
      () => fs.stat(workspace.reference),
      (err: NodeJS.ErrnoException) => err.code === "ENOENT",
    );
  });

  it("release is idempotent and does not reject when already gone", async () => {
    const workspace = await new ScratchDirProjectWorkspaceAdapter().open();
    await workspace.release();
    await workspace.release();
  });

  it("refuses to write through a symlinked parent that points outside the workspace", async () => {
    const workspace = await new ScratchDirProjectWorkspaceAdapter().open();
    const outside = await fs.mkdtemp("/tmp/hexagen-outside-");
    try {
      // A symlinked directory INSIDE the workspace pointing out of it: the
      // lexical containment check upstream cannot see this.
      await fs.symlink(outside, path.join(workspace.reference, "linked"));

      await assert.rejects(
        () => workspace.writeText(["linked", "escaped.ts"], "pwned"),
        /escapes project root via symlink/,
      );
      assert.deepEqual(await fs.readdir(outside), []);
    } finally {
      await workspace.release();
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("refuses to write when the target itself is a symlink", async () => {
    const workspace = await new ScratchDirProjectWorkspaceAdapter().open();
    const outside = await fs.mkdtemp("/tmp/hexagen-outside-");
    const victim = path.join(outside, "victim.txt");
    try {
      await fs.writeFile(victim, "original", "utf-8");
      await fs.symlink(victim, path.join(workspace.reference, "README.md"));

      await assert.rejects(
        () => workspace.writeText(["README.md"], "pwned"),
        /target is a symlink/,
      );
      assert.equal(await fs.readFile(victim, "utf-8"), "original");
    } finally {
      await workspace.release();
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
