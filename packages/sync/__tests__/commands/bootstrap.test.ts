/* eslint-disable turbo/no-undeclared-env-vars */
// turbo/no-undeclared-env-vars: CI + HEXAGEN_NO_PROMPT are observed by
// prompt-service.ts; this suite mutates them transiently and restores
// originals. Not a turbo task input.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import {
  bootstrapCommand,
  bootstrapCommander,
  deriveSystemAndScope,
  resolveWorkspaceSpecifier,
  runBootstrap,
  toTsMorphGlob,
} from "../../src/commands/bootstrap/index.js";

interface BootstrapFixture {
  root: string;
}

async function write(
  root: string,
  rel: string,
  contents: string,
): Promise<void> {
  const target = path.join(root, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, contents, "utf8");
}

async function createWorkspace(files: Record<string, string>): Promise<string> {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-bootstrap-")),
  );
  for (const [rel, contents] of Object.entries(files)) {
    await write(root, rel, contents);
  }
  return root;
}

describe("bootstrap helpers", () => {
  it("normalizes Windows separators for ts-morph globs", () => {
    assert.equal(
      toTsMorphGlob("C:\\ws\\packages\\billing\\src\\**\\*.ts"),
      "C:/ws/packages/billing/src/**/*.ts",
    );
  });

  it("matches workspace package roots and subpaths", () => {
    const names = ["@acme/orders", "@acme/orders-lib"];
    assert.equal(
      resolveWorkspaceSpecifier("@acme/orders/server", names),
      "@acme/orders",
    );
    assert.equal(
      resolveWorkspaceSpecifier("@acme/orders-lib", names),
      "@acme/orders-lib",
    );
    assert.equal(resolveWorkspaceSpecifier("express", names), undefined);
  });

  it("derives system and scope from the root package name", () => {
    assert.deepEqual(deriveSystemAndScope("@acme/monorepo"), {
      system: "monorepo",
      scope: "acme",
    });
    assert.deepEqual(deriveSystemAndScope("hexagen-monaco"), {
      system: "hexagen-monaco",
      scope: "hexagen-monaco",
    });
    assert.deepEqual(deriveSystemAndScope(undefined), {
      system: "generated-project",
      scope: "generated-project",
    });
  });
});

describe("bootstrapCommander (published CLI surface)", () => {
  it("is the command cli.ts registers via addCommand", () => {
    const src = readFileSync(
      new URL("../../src/cli.ts", import.meta.url),
      "utf8",
    );
    assert.equal((src.match(/\.command\("bootstrap"\)/g) ?? []).length, 0);
    assert.equal(
      (src.match(/addCommand\(bootstrapCommander\)/g) ?? []).length,
      1,
    );
    assert.equal(bootstrapCommander.name(), "bootstrap");
    assert.match(bootstrapCommander.description(), /question/i);
    assert.ok(bootstrapCommander.options.some((o) => o.long === "--yes"));
    assert.ok(bootstrapCommander.options.some((o) => o.long === "--force"));
  });
});

describe("runBootstrap / bootstrapCommand", () => {
  const originals = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    ci: process.env.CI,
    noPrompt: process.env.HEXAGEN_NO_PROMPT,
  };
  const fixtures: BootstrapFixture[] = [];

  beforeEach(() => {
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
    process.env.CI = "1";
    process.env.HEXAGEN_NO_PROMPT = "1";
  });

  afterEach(async () => {
    console.log = originals.log;
    console.error = originals.error;
    console.warn = originals.warn;
    if (originals.ci === undefined) delete process.env.CI;
    else process.env.CI = originals.ci;
    if (originals.noPrompt === undefined) delete process.env.HEXAGEN_NO_PROMPT;
    else process.env.HEXAGEN_NO_PROMPT = originals.noPrompt;
    await Promise.all(
      fixtures
        .splice(0)
        .map((fix) =>
          fs.rm(fix.root, { recursive: true, force: true }).catch(() => {}),
        ),
    );
  });

  async function fixture(files: Record<string, string>): Promise<string> {
    const root = await createWorkspace(files);
    fixtures.push({ root });
    return root;
  }

  it("bootstraps a workspace that has package.json workspaces and no manifest", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        name: "@acme/monorepo",
        private: true,
        workspaces: ["packages/*", "apps/*", "tools/*"],
      }),
      "packages/billing/package.json": JSON.stringify({
        name: "@acme/billing",
      }),
      "packages/billing/src/core/index.ts": `export const billing = 1;\n`,
      "packages/orders/package.json": JSON.stringify({ name: "@acme/orders" }),
      "packages/orders/src/server.ts": `export const orders = 1;\n`,
      "apps/web/package.json": JSON.stringify({ name: "@acme/web" }),
      "tools/arch-linter/package.json": JSON.stringify({
        name: "@acme/arch-linter",
      }),
    });

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
    ) as {
      system: string;
      scope: string;
      bounded_contexts: { name: string }[];
    };
    assert.equal(manifest.system, "monorepo");
    assert.equal(manifest.scope, "monorepo");
    assert.deepEqual(manifest.bounded_contexts.map((c) => c.name).sort(), [
      "arch-linter",
      "billing",
      "orders",
      "web",
    ]);

    const layout = yaml.load(
      await fs.readFile(
        path.join(root, ".architecture", "layout.yaml"),
        "utf8",
      ),
    ) as { contexts: Record<string, { root: string }> };
    assert.equal(layout.contexts.billing.root, "packages/billing");
    assert.equal(layout.contexts["arch-linter"].root, "tools/arch-linter");

    const baseline = JSON.parse(
      await fs.readFile(
        path.join(root, ".architecture", "arch-lint-baseline.json"),
        "utf8",
      ),
    ) as { version: unknown; entries: unknown };
    assert.equal(baseline.version, 1);
    assert.deepEqual(baseline.entries, []);
  });

  it("refuses to overwrite existing architecture artifacts without --force", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        name: "already-adopted",
        workspaces: ["packages/*"],
      }),
      ".architecture/manifest.yaml": "system: keep-me\nbounded_contexts: []\n",
      "packages/billing/package.json": JSON.stringify({ name: "billing" }),
    });

    const result = await runBootstrap({ root, yes: true });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.match(result.error.message, /overwrite|--force/i);
    }
    const kept = await fs.readFile(
      path.join(root, ".architecture", "manifest.yaml"),
      "utf8",
    );
    assert.match(kept, /keep-me/);
  });

  it("overwrites existing artifacts when --force is set", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        name: "@acme/monorepo",
        workspaces: ["packages/*"],
      }),
      ".architecture/manifest.yaml": "system: stale\nbounded_contexts: []\n",
      "packages/billing/package.json": JSON.stringify({
        name: "@acme/billing",
      }),
      "packages/billing/src/index.ts": `export const billing = 1;\n`,
    });

    const result = await runBootstrap({ root, yes: true, force: true });
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
    ) as { system: string; bounded_contexts: { name: string }[] };
    assert.equal(manifest.system, "monorepo");
    assert.ok(manifest.bounded_contexts.some((c) => c.name === "billing"));
  });

  it("skipLayout writes a missing manifest without replacing layout.yaml", async () => {
    const custom = "contexts:\n  leftover: { root: packages/old }\n";
    const root = await fixture({
      "package.json": JSON.stringify({
        name: "acme-app",
        workspaces: ["packages/*"],
      }),
      ".architecture/layout.yaml": custom,
      "packages/billing/package.json": JSON.stringify({ name: "billing" }),
      "packages/billing/src/index.ts": "export const billing = 1;\n",
    });

    const result = await runBootstrap({
      root,
      yes: true,
      skipLayout: true,
    });
    assert.equal(
      result.success,
      true,
      result.success ? "" : result.error.message,
    );
    assert.equal(
      await fs.readFile(
        path.join(root, ".architecture", "layout.yaml"),
        "utf8",
      ),
      custom,
    );
    const manifest = yaml.load(
      await fs.readFile(
        path.join(root, ".architecture", "manifest.yaml"),
        "utf8",
      ),
    ) as { bounded_contexts: { name: string }[] };
    assert.ok(manifest.bounded_contexts.some((c) => c.name === "billing"));
    if (result.success) {
      assert.equal(
        result.value.files.some((f) => path.basename(f) === "layout.yaml"),
        false,
      );
    }
  });

  it("refuses to replace a dangling manifest.yaml symlink without --force", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        name: "acme-app",
        workspaces: ["packages/*"],
      }),
      "packages/billing/package.json": JSON.stringify({ name: "billing" }),
      "packages/billing/src/index.ts": "export const billing = 1;\n",
    });
    const archDir = path.join(root, ".architecture");
    await fs.mkdir(archDir, { recursive: true });
    const manifestPath = path.join(archDir, "manifest.yaml");
    await fs.symlink("missing-target", manifestPath);

    const result = await runBootstrap({
      root,
      yes: true,
      skipLayout: true,
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.match(result.error.message, /overwrite|--force/i);
    }
    const st = await fs.lstat(manifestPath);
    assert.equal(st.isSymbolicLink(), true);
    assert.equal(await fs.readlink(manifestPath), "missing-target");
  });

  it("refuses to replace a dangling arch-lint-baseline.json symlink without --force", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        name: "acme-app",
        workspaces: ["packages/*"],
      }),
      "packages/billing/package.json": JSON.stringify({ name: "billing" }),
      "packages/billing/src/index.ts": "export const billing = 1;\n",
    });
    const archDir = path.join(root, ".architecture");
    await fs.mkdir(archDir, { recursive: true });
    const baselinePath = path.join(archDir, "arch-lint-baseline.json");
    await fs.symlink("missing-baseline", baselinePath);

    const result = await runBootstrap({
      root,
      yes: true,
      skipLayout: true,
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.match(result.error.message, /overwrite|--force/i);
    }
    const st = await fs.lstat(baselinePath);
    assert.equal(st.isSymbolicLink(), true);
    assert.equal(await fs.readlink(baselinePath), "missing-baseline");
  });

  it("refuses to replace a live manifest.yaml symlink without --force", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        name: "acme-app",
        workspaces: ["packages/*"],
      }),
      "packages/billing/package.json": JSON.stringify({ name: "billing" }),
      "packages/billing/src/index.ts": "export const billing = 1;\n",
    });
    const archDir = path.join(root, ".architecture");
    await fs.mkdir(archDir, { recursive: true });
    const target = path.join(archDir, "real-manifest.yaml");
    const manifestPath = path.join(archDir, "manifest.yaml");
    await fs.writeFile(
      target,
      "system: keep-me\nbounded_contexts: []\n",
      "utf8",
    );
    await fs.symlink("real-manifest.yaml", manifestPath);

    const result = await runBootstrap({
      root,
      yes: true,
      skipLayout: true,
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.match(result.error.message, /overwrite|--force/i);
    }
    assert.equal((await fs.lstat(manifestPath)).isSymbolicLink(), true);
    assert.match(await fs.readFile(manifestPath, "utf8"), /keep-me/);
  });

  it("rejects workspace patterns the detector cannot evaluate", async () => {
    for (const pattern of ["*", "packages/*/pkg"]) {
      const root = await fixture({
        "package.json": JSON.stringify({
          name: "wild",
          workspaces: [pattern],
        }),
        "packages/billing/package.json": JSON.stringify({ name: "billing" }),
      });
      const result = await runBootstrap({ root, yes: true });
      assert.equal(result.success, false);
      if (!result.success) {
        assert.match(result.error.message, /not supported|Complex globs/i);
      }
      await assert.rejects(
        fs.stat(path.join(root, ".architecture", "manifest.yaml")),
      );
    }
  });

  it("does not write a guessed manifest without ratification or --yes", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        name: "empty-repo",
        workspaces: ["packages/*"],
      }),
      "packages/billing/package.json": JSON.stringify({ name: "billing" }),
    });

    const result = await runBootstrap({ root });
    assert.equal(result.success, false);
    await assert.rejects(
      fs.stat(path.join(root, ".architecture", "manifest.yaml")),
    );
  });

  it("bootstrapCommand dry-run prints Would write and writes nothing", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        name: "@acme/monorepo",
        workspaces: ["packages/*"],
      }),
      "packages/billing/package.json": JSON.stringify({
        name: "@acme/billing",
      }),
    });
    const logs: string[] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    await bootstrapCommand({ root, yes: true, dryRun: true });
    const text = logs.join("\n");
    assert.doesNotMatch(text, /^Wrote:/m);
    assert.match(text, /Would write/i);
    await assert.rejects(
      fs.stat(path.join(root, ".architecture", "manifest.yaml")),
    );
  });

  it("dry-run refuses a tree that would be blocked without --force (does not print Would write)", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        name: "already-adopted",
        workspaces: ["packages/*"],
      }),
      ".architecture/manifest.yaml": "system: keep-me\nbounded_contexts: []\n",
      "packages/billing/package.json": JSON.stringify({ name: "billing" }),
    });

    const result = await runBootstrap({ root, yes: true, dryRun: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toMatch(/overwrite|--force/i);
    }

    const logs: string[] = [];
    const errors: string[] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    const previousExit = process.exitCode;
    try {
      await bootstrapCommand({ root, yes: true, dryRun: true });
      const text = [...logs, ...errors].join("\n");
      expect(text).not.toMatch(/Would write/i);
      expect(text).toMatch(/overwrite|--force/i);
    } finally {
      process.exitCode = previousExit;
    }

    const kept = await fs.readFile(
      path.join(root, ".architecture", "manifest.yaml"),
      "utf8",
    );
    expect(kept).toMatch(/keep-me/);
  });
});
