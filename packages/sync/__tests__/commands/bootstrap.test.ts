/* eslint-disable turbo/no-undeclared-env-vars */
// turbo/no-undeclared-env-vars: CI + HEXAGEN_NO_PROMPT are observed by
// prompt-service.ts; this suite mutates them transiently and restores
// originals. Not a turbo task input.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import {
  bootstrapCommand,
  deriveSystemAndScope,
  resolveWorkspaceSpecifier,
  toTsMorphGlob,
} from "../../src/commands/bootstrap.js";

const SKIP_NON_POSIX = process.platform === "win32";

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

async function withCwd<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return await fn();
  } finally {
    process.chdir(previous);
  }
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

describe("bootstrapCommand", () => {
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
      "packages/billing/src/index.ts": `export const billing = 1;\n`,
      "packages/orders/package.json": JSON.stringify({ name: "@acme/orders" }),
      "packages/orders/src/server.ts": `export const orders = 1;\n`,
      "apps/web/package.json": JSON.stringify({ name: "@acme/web" }),
      "tools/arch-linter/package.json": JSON.stringify({
        name: "@acme/arch-linter",
      }),
    });

    await withCwd(root, () => bootstrapCommand());

    const manifest = yaml.load(
      await fs.readFile(
        path.join(root, ".architecture", "manifest.yaml"),
        "utf8",
      ),
    ) as {
      system: string;
      scope: string;
      bounded_contexts: { name: string }[];
      apps: { name: string }[];
    };
    assert.equal(manifest.system, "monorepo");
    assert.equal(manifest.scope, "acme");
    assert.deepEqual(manifest.bounded_contexts.map((c) => c.name).sort(), [
      "arch-linter",
      "billing",
      "orders",
    ]);
    assert.deepEqual(
      manifest.apps.map((a) => a.name),
      ["web"],
    );

    const layout = yaml.load(
      await fs.readFile(
        path.join(root, ".architecture", "layout.yaml"),
        "utf8",
      ),
    ) as { layers: string[]; workspaces: Record<string, string> };
    assert.deepEqual(layout.layers, [
      "domain",
      "application",
      "infrastructure",
    ]);
    assert.equal(layout.workspaces.billing, "packages/billing");
    assert.equal(layout.workspaces["arch-linter"], "tools/arch-linter");

    const baseline = JSON.parse(
      await fs.readFile(
        path.join(root, ".architecture", "arch-lint-baseline.json"),
        "utf8",
      ),
    ) as { version: unknown; entries: unknown };
    assert.equal(baseline.version, 1);
    assert.deepEqual(baseline.entries, []);
  });

  it("records export-from, type-position import(), dynamic imports, tsx, and subpaths", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        name: "@acme/monorepo",
        workspaces: ["packages/*"],
      }),
      "packages/billing/package.json": JSON.stringify({
        name: "@acme/billing",
      }),
      "packages/billing/src/index.ts": `import { x } from "@acme/orders/server";\nexport const y = x;\n`,
      "packages/billing/src/widget.tsx": `export { shared } from "@acme/shared";\n`,
      "packages/billing/src/lazy.mts": `export async function load() {\n  return import("@acme/payments");\n}\n`,
      "packages/billing/src/types.cts": `export type T = import("@acme/identity").Foo;\n`,
      "packages/orders/package.json": JSON.stringify({ name: "@acme/orders" }),
      "packages/orders/src/server.ts": `export const x = 1;\n`,
      "packages/shared/package.json": JSON.stringify({ name: "@acme/shared" }),
      "packages/shared/src/index.ts": `export const shared = 1;\n`,
      "packages/payments/package.json": JSON.stringify({
        name: "@acme/payments",
      }),
      "packages/payments/src/index.ts": `export const pay = 1;\n`,
      "packages/identity/package.json": JSON.stringify({
        name: "@acme/identity",
      }),
      "packages/identity/src/index.ts": `export type Foo = string;\n`,
    });

    await withCwd(root, () => bootstrapCommand());

    const manifest = yaml.load(
      await fs.readFile(
        path.join(root, ".architecture", "manifest.yaml"),
        "utf8",
      ),
    ) as {
      bounded_contexts: { name: string; depends_on?: string[] }[];
    };
    const billing = manifest.bounded_contexts.find((c) => c.name === "billing");
    assert.ok(billing, "billing context missing");
    assert.deepEqual([...(billing.depends_on ?? [])].sort(), [
      "identity",
      "orders",
      "payments",
      "shared",
    ]);
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

    await assert.rejects(
      () => withCwd(root, () => bootstrapCommand()),
      /already exist/,
    );
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

    await withCwd(root, () => bootstrapCommand({ force: true }));
    const manifest = yaml.load(
      await fs.readFile(
        path.join(root, ".architecture", "manifest.yaml"),
        "utf8",
      ),
    ) as { system: string; bounded_contexts: { name: string }[] };
    assert.equal(manifest.system, "monorepo");
    assert.equal(manifest.bounded_contexts[0]?.name, "billing");
  });

  it("rejects workspace patterns the expander cannot evaluate", async () => {
    for (const pattern of ["!packages/legacy", "*", "packages/*/pkg"]) {
      const root = await fixture({
        "package.json": JSON.stringify({
          name: "wild",
          workspaces: [pattern],
        }),
        "packages/billing/package.json": JSON.stringify({ name: "billing" }),
      });
      await assert.rejects(
        () => withCwd(root, () => bootstrapCommand()),
        /Unsupported workspace pattern/,
      );
      await assert.rejects(
        fs.stat(path.join(root, ".architecture", "manifest.yaml")),
      );
    }
  });

  it("fails closed when no workspaces are discovered", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        name: "empty-repo",
        workspaces: ["packages/*"],
      }),
    });

    await assert.rejects(
      () => withCwd(root, () => bootstrapCommand()),
      /No workspaces found/,
    );
    await assert.rejects(
      fs.stat(path.join(root, ".architecture", "manifest.yaml")),
    );
  });

  it("does not write artifacts when a workspace package.json is malformed", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        name: "broken",
        workspaces: ["packages/*"],
      }),
      "packages/billing/package.json": "{ not json",
    });

    await assert.rejects(
      () => withCwd(root, () => bootstrapCommand()),
      /Malformed package.json/,
    );
    await assert.rejects(
      fs.stat(path.join(root, ".architecture", "manifest.yaml")),
    );
  });

  it.skipIf(SKIP_NON_POSIX)(
    "does not write artifacts when a workspace package.json is unreadable",
    async (ctx) => {
      const root = await fixture({
        "package.json": JSON.stringify({
          name: "denied",
          workspaces: ["packages/*"],
        }),
        "packages/billing/package.json": JSON.stringify({ name: "billing" }),
      });
      const pkgPath = path.join(root, "packages", "billing", "package.json");
      await fs.chmod(pkgPath, 0o000);
      try {
        await fs.readFile(pkgPath, "utf8");
        ctx.skip();
        return;
      } catch {
        // unreadable as intended
      }

      try {
        await assert.rejects(() => withCwd(root, () => bootstrapCommand()));
        await assert.rejects(
          fs.stat(path.join(root, ".architecture", "manifest.yaml")),
        );
      } finally {
        await fs.chmod(pkgPath, 0o644);
      }
    },
  );
});
