import assert from "node:assert";
import { describe, it, afterEach } from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SyncEngine } from "../../src/sync-engine.js";
import { generateStubs } from "../../src/generators/stubs.js";
import type { SyncFlags, LoggerPort } from "../../src/config.js";
import type { Manifest } from "../../src/types/manifest.js";
import { withTempWorkspace } from "../helpers/fs-helpers.js";
import { makeConfig } from "../helpers/test-config.js";
import { createSpyLogger } from "../helpers/spy-logger.js";

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
          subfolders: ["ports/in", "ports/out", "use-cases"],
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
          // A shared-base use-case + in-port. On this single fresh pass the use-case
          // is emitted BEFORE its application in-port (emission-plan-builder), so the
          // in-port file doesn't exist at probe time → generic. (On a re-sync the file
          // WOULD exist — but use-cases use the RAW guard, since #245's normalization
          // is adapter-only until #248 fixes the use-case emitter — so they still stay
          // generic; pinned directly in the second test below.)
          use_cases: ["place-order.use-case.ts"],
          ports: {
            in: ["place-order.in-port.ts"],
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

    // 4. A shared-base use-case stays GENERIC despite the guard matching, because
    //    use-cases are emitted before their application in-ports (so the in-port
    //    file doesn't exist at probe time). This pins that ordering invariant: if a
    //    future reorder makes use-cases resolve, generateUseCaseFromPort would emit
    //    a non-compiling stub (unimported interface + raw out-port constructor
    //    types — its own latent defect) and this assertion would flag it.
    const placeOrder = await fs.readFile(
      path.join(
        target!,
        "packages/demo/src/application/use-cases/PlaceOrder.use-case.ts",
      ),
      "utf8",
    );
    assert.doesNotMatch(
      placeOrder,
      /export class \w+ implements /,
      "use-case stays a generic stub (in-port not yet emitted at probe time)",
    );
  });
});

describe("use-case related-port resolution stays raw/adapter-only (#245 scope, #248)", () => {
  it("a shared-base use-case stays generic even when its in-port file already exists (re-sync)", async () => {
    await withTempWorkspace(
      async ({ workspaceRoot }: { workspaceRoot: string }) => {
        const moduleDir = path.join(workspaceRoot, "packages", "demo");
        // Pre-create the in-port file so it EXISTS at probe time — the re-sync /
        // hand-authored-port case that emission ordering hides on a fresh pass.
        const inDir = path.join(moduleDir, "src", "application", "ports", "in");
        await fs.mkdir(inDir, { recursive: true });
        await fs.writeFile(
          path.join(inDir, "PlaceOrder.in-port.ts"),
          "export interface PlaceOrderPort {\n  execute(): Promise<void>;\n}\n",
        );

        const manifest2 = {
          system: "acme",
          scope: "acme",
          architecture: "modular-monolith",
          generator: {
            sync: {
              layers: {
                application: {
                  folder: "src/application",
                  subfolders: ["ports/in", "ports/out", "use-cases"],
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
                  use_cases: ["place-order.use-case.ts"],
                  ports: {
                    in: ["place-order.in-port.ts"],
                    out: ["account-repo.out-port.ts"],
                  },
                },
              },
            },
          ],
        } as unknown as Manifest;

        await generateStubs(
          moduleDir,
          "demo",
          makeConfig(workspaceRoot, manifest2, { logger: createSpyLogger() }),
        );

        const uc = await fs.readFile(
          path.join(
            moduleDir,
            "src/application/use-cases/PlaceOrder.use-case.ts",
          ),
          "utf8",
        );
        // Use-cases are NOT normalized in the guard (#245 is adapter-only until #248).
        // So even with the in-port present, a kebab use-case+in-port doesn't match →
        // generic stub (which compiles). If a future change normalizes the use-case
        // guard without first fixing generateUseCaseFromPort (#248), this resolves into
        // the broken output (`implements <Port>` + raw out-port constructor types) and
        // this assertion fails — exactly the regression we want flagged.
        assert.doesNotMatch(
          uc,
          /export class \w+ implements /,
          "use-case stays generic even when the in-port exists (raw guard, adapter-only normalization)",
        );
      },
    );
  });
});
