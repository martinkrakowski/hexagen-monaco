import assert from "node:assert";
import { describe, it, afterEach } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SyncEngine } from "../../src/sync-engine.js";
import type { SyncFlags, LoggerPort } from "../../src/config.js";
import type { Manifest } from "../../src/types/manifest.js";

/**
 * #245: tryAnalyzeRelatedPort decides whether an adapter/use-case stub is derived
 * from its related port (gaining `implements <Port>` + the port import) or falls
 * back to a generic stub. Its declared-port guard compared the (normalized)
 * derived name against RAW manifest port names, so a shared-base adapter+port
 * pair expressed with kebab/extensioned names (`user-repo.adapter.ts` +
 * `user-repo.out-port.ts`) failed to resolve even though the clean equivalent
 * (`UserRepo`) worked. The fix normalizes both sides of the comparison.
 *
 * An adapter whose name doesn't correlate to any port (`Prisma` vs an
 * `relational-db` out-port) must still fall back to a generic stub — name-based
 * resolution can't (and shouldn't) link them.
 */

const silentLogger: LoggerPort = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  errorWithException: () => {},
};

const makeExternalFlags = (): SyncFlags => ({
  dryRun: false,
  force: true,
  forceRoot: true,
  allowDirty: true,
  strict: false,
  mode: "external",
  logger: silentLogger,
});

const manifest: Manifest = {
  system: "acme",
  scope: "acme",
  architecture: "modular-monolith",
  monorepo: {
    packageManager: "yarn@4.12.0",
    workspaces: ["apps/*", "packages/*"],
  },
  generator: {
    sync: {
      layers: {
        domain: { folder: "src/domain" },
        application: {
          folder: "src/application",
          subfolders: ["ports/in", "ports/out"],
        },
        infrastructure: {
          folder: "src/infrastructure",
          subfolders: ["adapters"],
        },
      },
      stubs: { enabled: true },
    },
  },
  bounded_contexts: [
    {
      name: "demo",
      type: "core",
      layers: {
        application: {
          ports: {
            in: [],
            // clean shared-base, kebab/extensioned shared-base, and an out-port
            // that no adapter correlates to.
            out: [
              "AccountRepo",
              "user-repo.out-port.ts",
              "relational-db.out-port.ts",
            ],
          },
        },
        infrastructure: {
          adapters: [
            "AccountRepo", // clean shared-base → resolves
            "user-repo.adapter.ts", // kebab/ext shared-base → resolves (the fix)
            "Prisma.adapter.ts", // uncorrelated → generic
          ],
        },
      },
    },
  ],
} as unknown as Manifest;

describe("related-port resolution (#245)", () => {
  let target: string | null = null;
  afterEach(async () => {
    if (target) {
      await fs.rm(target, { recursive: true, force: true });
      target = null;
    }
  });

  it("derives adapters from a shared-base port for clean AND kebab/extensioned names, and leaves uncorrelated adapters generic", async () => {
    target = await fs.mkdtemp(path.join(os.tmpdir(), "hexagen-245-"));
    await new SyncEngine(makeExternalFlags(), {
      targetRoot: target,
      manifest,
    }).run();

    const read = (file: string) =>
      fs.readFile(
        path.join(target!, "packages/demo/src/infrastructure/adapters", file),
        "utf8",
      );

    // 1. Clean shared-base — port-derived (regression guard).
    const account = await read("AccountRepo.adapter.ts");
    assert.match(
      account,
      /export class \w+ implements AccountRepoPort\b/,
      "clean shared-base adapter implements its port",
    );

    // 2. Kebab/extensioned shared-base — now port-derived (the #245 fix).
    const userRepo = await read("UserRepo.adapter.ts");
    assert.match(
      userRepo,
      /export class \w+ implements UserRepoPort\b/,
      "kebab/extensioned shared-base adapter resolves to its port",
    );
    assert.match(
      userRepo,
      /import type \{ UserRepoPort \} from '\.\.\/\.\.\/application\/ports\/out\/UserRepo\.out-port\.js'/,
      "and imports the port interface it implements",
    );

    // 3. Uncorrelated adapter — generic (name-based resolution must not link
    //    `Prisma` to the `relational-db` out-port).
    const prisma = await read("Prisma.adapter.ts");
    assert.doesNotMatch(
      prisma,
      /export class \w+ implements /,
      "an adapter with no name-correlated port stays a generic stub",
    );
  });
});
