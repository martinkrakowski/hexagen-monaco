import { describe, it } from "vitest";
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
});
