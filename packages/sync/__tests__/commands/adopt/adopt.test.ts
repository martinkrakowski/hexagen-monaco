import { describe, expect, it } from "vitest";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { runAdopt } from "../../../src/commands/adopt/index.js";

async function makeRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-adopt-"));
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "acme-app",
      private: true,
      workspaces: ["packages/*"],
    }),
    "utf8",
  );
  await fs.mkdir(path.join(root, "packages", "billing", "src", "core"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(root, "packages", "billing", "package.json"),
    JSON.stringify({ name: "@acme/billing" }),
    "utf8",
  );
  await fs.writeFile(
    path.join(root, "packages", "billing", "src", "core", "invoice.ts"),
    "export const invoice = 1;\n",
    "utf8",
  );
  await fs.mkdir(path.join(root, "packages", "billing", "src", "services"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(root, "packages", "billing", "src", "services", "charge.ts"),
    "export const charge = 1;\n",
    "utf8",
  );
  return root;
}

describe("hexagen adopt", () => {
  it("writes layout.yaml from detected packages when --yes is set", async () => {
    const root = await makeRepo();
    try {
      const result = await runAdopt({ root, yes: true });
      assert.equal(
        result.success,
        true,
        result.success ? "" : result.error.message,
      );
      const layoutPath = path.join(root, ".architecture", "layout.yaml");
      const raw = await fs.readFile(layoutPath, "utf8");
      const parsed = yaml.load(raw) as {
        contexts: Record<
          string,
          { root: string; layers?: Record<string, string[]> }
        >;
      };
      assert.equal(parsed.contexts.billing.root, "packages/billing");
      assert.deepEqual(parsed.contexts.billing.layers?.domain, ["src/core"]);
      assert.deepEqual(parsed.contexts.billing.layers?.application, [
        "src/services",
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to write without ratification or --yes", async () => {
    const root = await makeRepo();
    try {
      const result = await runAdopt({ root, yes: false });
      assert.equal(result.success, false);
      if (!result.success) {
        assert.match(result.error.message, /--yes/);
        assert.doesNotMatch(result.error.message, /TTY/);
      }
      const layoutPath = path.join(root, ".architecture", "layout.yaml");
      await assert.rejects(fs.stat(layoutPath));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("prints a dry-run preview without --yes and does not write", async () => {
    const root = await makeRepo();
    try {
      const result = await runAdopt({ root, dryRun: true });
      assert.equal(
        result.success,
        true,
        result.success ? "" : result.error.message,
      );
      if (result.success) {
        assert.equal(result.value.wrote, false);
        assert.match(result.value.nextSteps.join("\n"), /Dry-run/);
      }
      await assert.rejects(
        fs.stat(path.join(root, ".architecture", "layout.yaml")),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to replace a dangling layout.yaml symlink without --force", async () => {
    const root = await makeRepo();
    try {
      const archDir = path.join(root, ".architecture");
      await fs.mkdir(archDir, { recursive: true });
      const layoutPath = path.join(archDir, "layout.yaml");
      await fs.symlink("missing-target", layoutPath);

      const result = await runAdopt({ root, yes: true });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toMatch(/overwrite|--force/i);
      }
      const st = await fs.lstat(layoutPath);
      expect(st.isSymbolicLink()).toBe(true);
      expect(await fs.readlink(layoutPath)).toBe("missing-target");
      await expect(
        fs.stat(path.join(archDir, "missing-target")),
      ).rejects.toThrow();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("does not treat a non-ENOENT layout probe as absence", async () => {
    const root = await makeRepo();
    const layoutPath = path.join(root, ".architecture", "layout.yaml");
    const originalStat = fs.stat;
    const originalLstat = fs.lstat;
    const denyLayout = async (
      original: typeof fs.stat,
      target: Parameters<typeof fs.stat>[0],
      extra?: Parameters<typeof fs.stat>[1],
    ) => {
      if (path.resolve(String(target)) === path.resolve(layoutPath)) {
        const e = new Error(
          `EACCES: permission denied, stat '${String(target)}'`,
        ) as NodeJS.ErrnoException;
        e.code = "EACCES";
        throw e;
      }
      return extra === undefined ? original(target) : original(target, extra);
    };
    fs.stat = ((
      target: Parameters<typeof fs.stat>[0],
      extra?: Parameters<typeof fs.stat>[1],
    ) => denyLayout(originalStat, target, extra)) as typeof fs.stat;
    fs.lstat = ((
      target: Parameters<typeof fs.lstat>[0],
      extra?: Parameters<typeof fs.lstat>[1],
    ) => denyLayout(originalLstat, target, extra)) as typeof fs.lstat;
    try {
      const result = await runAdopt({ root, yes: true });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.message).toMatch(/EACCES/);
      }
      await expect(originalLstat(layoutPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      fs.stat = originalStat;
      fs.lstat = originalLstat;
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
