import assert from "node:assert/strict";
import { describe, it, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateSharedKernel } from "../../src/generators/shared-kernel.js";
import type { SyncConfig, LoggerPort } from "../../src/config.js";
import type { Manifest } from "../../src/types/manifest.js";

/**
 * #246: the generic use-case stub imports `Result` from `@{scope}/shared`.
 * generateSharedKernel writes a `Result` kernel into the scaffolded shared
 * package so that import resolves and the generated project typechecks.
 */

const silentLogger: LoggerPort = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  errorWithException: () => {},
};

function makeConfig(
  workspaceRoot: string,
  manifest: Manifest,
  mode: SyncConfig["mode"] = "external",
): SyncConfig {
  return {
    dryRun: false,
    force: true,
    forceRoot: true,
    allowDirty: true,
    strict: false,
    mode,
    logger: silentLogger,
    manifest,
    workspaceRoot,
  };
}

const withShared = {
  bounded_contexts: [
    { name: "orders", type: "core" },
    { name: "shared", type: "supporting" },
  ],
} as unknown as Manifest;

const kernelRel = "packages/shared/src/domain/result.ts";

describe("generateSharedKernel (#246)", () => {
  let tmp: string | null = null;
  afterEach(async () => {
    if (tmp) {
      await fs.rm(tmp, { recursive: true, force: true });
      tmp = null;
    }
  });

  it("writes a Result kernel under the shared domain layer when a shared context exists", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-kernel-"));
    const result = await generateSharedKernel(makeConfig(tmp, withShared));

    const kernelPath = path.join(tmp, kernelRel);
    const body = await fs.readFile(kernelPath, "utf8");
    // The exact shape the generic use-case stub relies on:
    //   import type { Result } ...; Promise<Result<unknown, Error>>;
    //   return { success: false, error: new Error(...) };
    assert.match(body, /export type Result<T, E = unknown>/);
    assert.match(body, /\{ success: true; value: T \}/);
    assert.match(body, /\{ success: false; error: E \}/);
    assert.ok(
      result.created.some((p) => p.endsWith(path.normalize(kernelRel))),
      "kernel reported as created",
    );
  });

  it("is a no-op in self-regen mode even with a shared context (two-worlds guard, #249/#250)", async () => {
    // In this monorepo `packages/shared` is hand-maintained and already exports
    // Result (errors/result.ts); writing domain/result.ts here would double the
    // export and break the build. The kernel is external-generation only.
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-kernel-"));
    const result = await generateSharedKernel(
      makeConfig(tmp, withShared, "self-regen"),
    );

    assert.strictEqual(result.totalOps, 0);
    assert.strictEqual(
      await fs
        .access(path.join(tmp, kernelRel))
        .then(() => true)
        .catch(() => false),
      false,
      "self-regen must not write the shared Result kernel",
    );
  });

  it("is a no-op when there is no shared context", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-kernel-"));
    const noShared = {
      bounded_contexts: [{ name: "orders", type: "core" }],
    } as unknown as Manifest;

    const result = await generateSharedKernel(makeConfig(tmp, noShared));

    assert.strictEqual(result.totalOps, 0);
    assert.strictEqual(
      await fs
        .access(path.join(tmp, "packages/shared"))
        .then(() => true)
        .catch(() => false),
      false,
      "no shared package directory created",
    );
  });

  it("preserves a user-customized kernel on re-sync (write-if-absent)", async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-kernel-"));
    const kernelPath = path.join(tmp, kernelRel);
    const custom = "export type Result<T> = { ok: boolean; value?: T };\n";
    await fs.mkdir(path.dirname(kernelPath), { recursive: true });
    await fs.writeFile(kernelPath, custom);

    const result = await generateSharedKernel(makeConfig(tmp, withShared));

    assert.strictEqual(
      await fs.readFile(kernelPath, "utf8"),
      custom,
      "existing kernel must not be overwritten",
    );
    assert.strictEqual(result.totalOps, 0, "no write counted");
  });
});
