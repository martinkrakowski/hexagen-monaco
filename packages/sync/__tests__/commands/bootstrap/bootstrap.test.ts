import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { runBootstrap } from "../../../src/commands/bootstrap/index.js";

async function makeRepo(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-bootstrap-"));
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
  return root;
}

describe("hexagen bootstrap", () => {
  it("does not write a guessed manifest without ratification or --yes", async () => {
    const root = await makeRepo();
    try {
      const result = await runBootstrap({ root });
      assert.equal(result.success, false);
      await assert.rejects(
        fs.stat(path.join(root, ".architecture", "manifest.yaml")),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("emits manifest + layout + baseline in one pass with --yes", async () => {
    const root = await makeRepo();
    try {
      const result = await runBootstrap({ root, yes: true });
      assert.equal(
        result.success,
        true,
        result.success ? "" : result.error.message,
      );

      const manifest = yaml.load(
        await fs.readFile(
          path.join(root, ".architecture", "manifest.yaml"),
          "utf8",
        ),
      ) as { bounded_contexts: { name: string }[] };
      assert.ok(manifest.bounded_contexts.some((c) => c.name === "billing"));

      const layout = yaml.load(
        await fs.readFile(
          path.join(root, ".architecture", "layout.yaml"),
          "utf8",
        ),
      ) as { contexts: Record<string, { root: string }> };
      assert.equal(layout.contexts.billing.root, "packages/billing");

      const baseline = JSON.parse(
        await fs.readFile(
          path.join(root, ".architecture", "arch-lint-baseline.json"),
          "utf8",
        ),
      ) as { version: number; entries: unknown[] };
      assert.equal(baseline.version, 1);
      assert.deepEqual(baseline.entries, []);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("honours an answers file and skips un-included candidates", async () => {
    const root = await makeRepo();
    try {
      const answersPath = path.join(root, "answers.json");
      await fs.writeFile(
        answersPath,
        JSON.stringify({
          system: "acme-app",
          scope: "acme",
          architecture: "modular-monolith",
          contexts: [
            {
              name: "billing",
              include: true,
              type: "core",
              root: "packages/billing",
            },
          ],
        }),
        "utf8",
      );
      const result = await runBootstrap({ root, answersPath });
      assert.equal(
        result.success,
        true,
        result.success ? "" : result.error.message,
      );
      const manifest = yaml.load(
        await fs.readFile(
          path.join(root, ".architecture", "manifest.yaml"),
          "utf8",
        ),
      ) as {
        system: string;
        scope: string;
        bounded_contexts: { name: string }[];
      };
      assert.equal(manifest.system, "acme-app");
      assert.equal(manifest.scope, "acme");
      assert.deepEqual(
        manifest.bounded_contexts.map((c) => c.name),
        ["billing"],
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("--llm errors with a clear not-wired message and writes nothing", async () => {
    const root = await makeRepo();
    try {
      const result = await runBootstrap({ root, yes: true, llm: true });
      assert.equal(result.success, false);
      if (!result.success) {
        assert.match(result.error.message, /not wired yet/i);
      }
      await assert.rejects(
        fs.stat(path.join(root, ".architecture", "manifest.yaml")),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
