/**
 * HXA1a — removeAdapter / removeDependency through the write port and
 * adapter, plus the new pending-mutation kinds through grant approval and
 * applyPendingManifestMutation.
 *
 * Guards pinned per test (stated in each title):
 * - referential: a missing context / port / adapter / dependency is a typed
 *   Result refusal, never a silent { removed: false } success;
 * - hostile-input: null/undefined/wrong primitive/throwing getter/array-like/
 *   enormous length/prototype-polluting keys are refused without invoking
 *   getters (descriptor inspection only);
 * - grant: remove-adapter / remove-dependency derive a MutationRef and pass
 *   checkMutationAgainstGrant exactly like the create kinds;
 * - effects: AdapterRemoved / DependencyRemoved publish only on removed=true;
 *   write-port failures surface; missing write-port methods refuse by name;
 * - fail-closed accept (fix round 4): an own data property whose value is
 *   `undefined` is kept by the snapshot, never a refusal; a present-but-
 *   refused pending mutation denies the accept (typed refusal, trace line
 *   recorded as denied, transaction never committed) — pinned end to end
 *   through the `hexagen_accept_transaction` TOOL HANDLER.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { InMemoryTransactionManager } from "@hexagen/transaction-system";
import { ManifestWriteAdapter } from "../../src/infrastructure/adapters/manifest-write.adapter.js";
import {
  applyPendingManifestMutation,
  PendingMutationRefusedError,
  readPendingMutation,
  readPendingMutationStatus,
  PENDING_MANIFEST_MUTATION_KEY,
  type PendingRemoveAdapterInput,
  type PendingRemoveDependencyInput,
} from "../../src/application/pending-manifest-mutation.js";
import { AcceptTransactionToolUseCase } from "../../src/application/use-cases/accept-transaction-tool.use-case.js";
import { CreateContextToolUseCase } from "../../src/application/use-cases/create-context-tool.use-case.js";
import { ScaffoldModuleToolUseCase } from "../../src/application/use-cases/scaffold-module-tool.use-case.js";
import { toolRegistry } from "../../src/infrastructure/adapters/tools/registry.js";
import type { MCPServerAdapterDependencies } from "../../src/infrastructure/adapters/mcp-server.types.js";
import type { GrantSignaturePort } from "../../src/application/ports/out/grant-signature.port.js";
import type {
  GrantMissingAppendInput,
  TraceAppendInput,
  TraceWritePort,
} from "../../src/application/ports/out/trace-write.port.js";
import {
  deriveMutationRef,
  checkMutationAgainstGrant,
  MANIFEST_WRITE_PATH,
  type Grant,
} from "../../src/application/kernel/grant.js";
import type { EventBusPort } from "@hexagen/messaging";
import type { Result } from "@hexagen/shared";
import type { ManifestWritePort } from "../../src/application/ports/out/manifest-write.port.js";
import type { ScaffoldingPort } from "../../src/application/ports/out/scaffolding.port.js";

function contextWithPort(name: string, portName: string, adapterName: string) {
  return {
    name,
    type: "core" as const,
    description: "",
    depends_on: [] as string[],
    layers: {
      domain: {},
      application: { ports: { in: [], out: [portName] } },
      infrastructure: { adapters: [adapterName] },
    },
  };
}

const BASE_MANIFEST = {
  version: "1.0",
  bounded_contexts: [
    contextWithPort("billing", "PaymentPort", "PaymentAdapter"),
    {
      name: "shipping",
      type: "core" as const,
      description: "",
      layers: {
        domain: {},
        application: { ports: { in: [], out: [] } },
        infrastructure: { adapters: [] },
      },
    },
  ],
};

async function withTempWorkspace<T>(
  initialManifest: Record<string, unknown>,
  fn: (workspaceRoot: string, manifestPath: string) => Promise<T>,
): Promise<T> {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "manifest-write-remove-test-"),
  );
  const manifestPath = path.join(tmpDir, ".architecture", "manifest.yaml");
  await fs.mkdir(path.join(tmpDir, ".architecture"), { recursive: true });
  await fs.writeFile(
    manifestPath,
    yaml.dump(initialManifest, { indent: 2, sortKeys: false, lineWidth: 0 }),
    "utf-8",
  );
  try {
    return await fn(tmpDir, manifestPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function adapterFor(workspaceRoot: string): ManifestWriteAdapter {
  return new ManifestWriteAdapter(workspaceRoot);
}

async function readManifestYaml(
  manifestPath: string,
): Promise<Record<string, unknown>> {
  return yaml.load(await fs.readFile(manifestPath, "utf-8")) as Record<
    string,
    unknown
  >;
}

// Runtime-built key strings — never literal key-shaped tokens in source.
const PROTO_KEY = ["__", "proto", "__"].join("");
const CONSTRUCTOR_KEY = "con" + "structor";
const PROTOTYPE_KEY = "proto" + "type";

function msg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class EventBusFake implements EventBusPort {
  published: Array<{ type: string; payload: Record<string, unknown> }> = [];
  subscribe(): () => void {
    return () => {};
  }
  publish(event: unknown): void {
    const e = event as { type: string; payload: Record<string, unknown> };
    this.published.push({ type: e.type, payload: e.payload });
  }
  unsubscribe(): void {}
  clear(): void {}
}

class ScaffoldingNoop implements ScaffoldingPort {
  async scaffoldModule(): Promise<Result<{ filesCreated: string[] }>> {
    throw new Error("scaffoldModule must not be called by remove mutations");
  }
  async createPort(): Promise<Result<{ fileCreated: string }>> {
    throw new Error("createPort must not be called by remove mutations");
  }
  async createAdapter(): Promise<Result<{ fileCreated: string }>> {
    throw new Error("createAdapter must not be called by remove mutations");
  }
  async deleteCreatedFiles(
    paths: string[],
  ): Promise<Result<{ deleted: string[] }>> {
    return { success: true, value: { deleted: [...paths] } };
  }
}

/**
 * ManifestWritePort double with per-method call counters and configurable
 * results, so each test can prove exactly which port method ran and what
 * its outcome was.
 */
class WriteSpy implements ManifestWritePort {
  calls: string[] = [];
  removeAdapterResult: Result<{ removed: boolean }> = {
    success: true,
    value: { removed: true },
  };
  removeDependencyResult: Result<{ removed: boolean }> = {
    success: true,
    value: { removed: true },
  };

  async validateDependency(): Promise<
    Result<{ valid: boolean; errors: string[] }>
  > {
    return { success: true, value: { valid: true, errors: [] } };
  }
  async addDependency(): Promise<Result<{ updated: boolean }>> {
    this.calls.push("addDependency");
    return { success: true, value: { updated: true } };
  }
  async registerBoundedContext(): Promise<
    Result<{ registered: boolean; alreadyExisted: boolean }>
  > {
    this.calls.push("registerBoundedContext");
    return { success: true, value: { registered: true, alreadyExisted: false } };
  }
  async registerPort(): Promise<Result<{ registered: boolean }>> {
    this.calls.push("registerPort");
    return { success: true, value: { registered: true } };
  }
  async registerAdapter(): Promise<Result<{ registered: boolean }>> {
    this.calls.push("registerAdapter");
    return { success: true, value: { registered: true } };
  }
  async removePort(): Promise<Result<{ removed: boolean }>> {
    this.calls.push("removePort");
    return { success: true, value: { removed: true } };
  }
  async removeAdapter(): Promise<Result<{ removed: boolean }>> {
    this.calls.push("removeAdapter");
    return this.removeAdapterResult;
  }
  async removeDependency(): Promise<Result<{ removed: boolean }>> {
    this.calls.push("removeDependency");
    return this.removeDependencyResult;
  }
  async removeContext(): Promise<Result<{ removed: boolean }>> {
    this.calls.push("removeContext");
    return { success: true, value: { removed: true } };
  }
}

function makePorts(
  manifestWrite: ManifestWritePort,
  events: EventBusFake = new EventBusFake(),
) {
  return {
    manifestWrite,
    scaffolding: new ScaffoldingNoop(),
    eventBus: events,
  };
}

function minimalTx(metadata: Record<string, unknown>): Parameters<
  typeof readPendingMutation
>[0] {
  return { metadata } as unknown as Parameters<typeof readPendingMutation>[0];
}

function grant(): Grant {
  return {
    id: "grant-test",
    principal: "martin",
    agent: "test-agent",
    contexts: ["billing", "shipping"],
    paths: [MANIFEST_WRITE_PATH],
    tools: [
      "hexagen_remove_adapter",
      "hexagen_remove_dependency",
      "hexagen_remove_port",
      "hexagen_remove_context",
      "hexagen_create_adapter",
      "hexagen_add_dependency",
    ],
    mode: "write",
    max_files: 4,
    expires_at: "2099-01-01T00:00:00.000Z",
  };
}

describe("manifest write remove", () => {
  describe("removeAdapter through the port and adapter", () => {
    it("removeAdapter removes a declared adapter from the context and persists the manifest", async () => {
      await withTempWorkspace(BASE_MANIFEST, async (workspaceRoot, mp) => {
        const result = await adapterFor(workspaceRoot).removeAdapter({
          contextName: "billing",
          adapterName: "PaymentAdapter",
          portName: "PaymentPort",
        });
        assert.equal(result.success, true);
        if (!result.success) return;
        assert.equal(result.value.removed, true);
        const onDisk = await readManifestYaml(mp);
        const billing = (
          onDisk.bounded_contexts as Array<Record<string, unknown>>
        ).find((c) => c.name === "billing");
        assert.deepEqual(billing?.layers, {
          domain: {},
          application: { ports: { in: [], out: ["PaymentPort"] } },
          infrastructure: { adapters: [] },
        });
      });
    });

    it("removeAdapter refuses a missing bounded context with a typed error naming it", async () => {
      await withTempWorkspace(BASE_MANIFEST, async (workspaceRoot, mp) => {
        const result = await adapterFor(workspaceRoot).removeAdapter({
          contextName: "nope",
          adapterName: "PaymentAdapter",
          portName: "PaymentPort",
        });
        assert.equal(result.success, false);
        if (result.success) return;
        assert.match(msg(result.error), /Bounded context not found: nope/);
        // Guard: no write happened.
        assert.deepEqual(await readManifestYaml(mp), BASE_MANIFEST);
      });
    });

    it("removeAdapter refuses an undeclared port with a typed error", async () => {
      await withTempWorkspace(BASE_MANIFEST, async (workspaceRoot) => {
        const result = await adapterFor(workspaceRoot).removeAdapter({
          contextName: "billing",
          adapterName: "PaymentAdapter",
          portName: "MissingPort",
        });
        assert.equal(result.success, false);
        if (result.success) return;
        assert.match(msg(result.error), /Port not found in context billing/);
      });
    });

    it("removeAdapter refuses a missing adapter instead of returning removed:false", async () => {
      await withTempWorkspace(BASE_MANIFEST, async (workspaceRoot) => {
        const result = await adapterFor(workspaceRoot).removeAdapter({
          contextName: "billing",
          adapterName: "NotThereAdapter",
          portName: "PaymentPort",
        });
        assert.equal(result.success, false);
        if (result.success) return;
        assert.match(
          msg(result.error),
          /Adapter not found in context billing: NotThereAdapter/,
        );
      });
    });
  });

  describe("removeDependency through the port and adapter", () => {
    it("removeDependency removes an existing depends_on edge and persists the manifest", async () => {
      const manifest = structuredClone(BASE_MANIFEST) as Record<
        string,
        unknown
      >;
      (
        (manifest.bounded_contexts as Array<Record<string, unknown>>)[0]!
      ).depends_on = ["shipping"];
      await withTempWorkspace(manifest, async (workspaceRoot, mp) => {
        const result = await adapterFor(workspaceRoot).removeDependency({
          sourceModule: "billing",
          targetModule: "shipping",
        });
        assert.equal(result.success, true);
        if (!result.success) return;
        assert.equal(result.value.removed, true);
        const onDisk = await readManifestYaml(mp);
        const billing = (
          onDisk.bounded_contexts as Array<Record<string, unknown>>
        ).find((c) => c.name === "billing");
        assert.deepEqual(billing?.depends_on, []);
      });
    });

    it("removeDependency refuses a missing source module with a typed error", async () => {
      await withTempWorkspace(BASE_MANIFEST, async (workspaceRoot) => {
        const result = await adapterFor(workspaceRoot).removeDependency({
          sourceModule: "ghost",
          targetModule: "shipping",
        });
        assert.equal(result.success, false);
        if (result.success) return;
        assert.match(msg(result.error), /Source module not found: ghost/);
      });
    });

    it("removeDependency refuses a missing target module and an absent dependency edge", async () => {
      await withTempWorkspace(BASE_MANIFEST, async (workspaceRoot) => {
        const missingTarget = await adapterFor(workspaceRoot).removeDependency(
          {
            sourceModule: "billing",
            targetModule: "ghost",
          },
        );
        assert.equal(missingTarget.success, false);
        if (!missingTarget.success) {
          assert.match(
            msg(missingTarget.error),
            /Target module not found: ghost/,
          );
        }

        // billing exists but has no depends_on edge to shipping.
        const absentEdge = await adapterFor(workspaceRoot).removeDependency({
          sourceModule: "billing",
          targetModule: "shipping",
        });
        assert.equal(absentEdge.success, false);
        if (absentEdge.success) return;
        assert.match(
          msg(absentEdge.error),
          /Dependency not found: billing does not depend on shipping/,
        );
      });
    });

    it("removeDependency refuses self-dependency with a typed error", async () => {
      await withTempWorkspace(BASE_MANIFEST, async (workspaceRoot) => {
        const result = await adapterFor(workspaceRoot).removeDependency({
          sourceModule: "billing",
          targetModule: "billing",
        });
        assert.equal(result.success, false);
        if (result.success) return;
        assert.match(
          msg(result.error),
          /Source and target modules cannot be the same: billing/,
        );
      });
    });
  });

  describe("hostile-input refusal", () => {
    it("refuses null, undefined, and wrong-primitive commands for both removes", async () => {
      await withTempWorkspace(BASE_MANIFEST, async (workspaceRoot) => {
        const adapter = adapterFor(workspaceRoot);
        const badCommands: unknown[] = [
          null,
          undefined,
          "billing",
          42,
          ["billing"],
        ];
        for (const bad of badCommands) {
          const ra = await adapter.removeAdapter(
            bad as Parameters<ManifestWriteAdapter["removeAdapter"]>[0],
          );
          assert.equal(ra.success, false, `removeAdapter(${String(bad)})`);
          if (!ra.success) {
            assert.match(msg(ra.error), /Invalid command/);
          }
          const rd = await adapter.removeDependency(
            bad as Parameters<ManifestWriteAdapter["removeDependency"]>[0],
          );
          assert.equal(rd.success, false, `removeDependency(${String(bad)})`);
        }
      });
    });

    it("refuses blank and enormous-length field values without touching the manifest", async () => {
      await withTempWorkspace(BASE_MANIFEST, async (workspaceRoot) => {
        const adapter = adapterFor(workspaceRoot);
        const blank = await adapter.removeAdapter({
          contextName: "   ",
          adapterName: "PaymentAdapter",
          portName: "PaymentPort",
        });
        assert.equal(blank.success, false);
        if (!blank.success) {
          assert.match(msg(blank.error), /non-blank/);
        }
        const enormous = "x".repeat(5000);
        const tooLong = await adapter.removeDependency({
          sourceModule: enormous,
          targetModule: "shipping",
        });
        assert.equal(tooLong.success, false);
        if (!tooLong.success) {
          assert.match(msg(tooLong.error), /maximum length/);
        }
      });
    });

    it("refuses a throwing getter without invoking it (descriptor inspection only)", async () => {
      await withTempWorkspace(BASE_MANIFEST, async (workspaceRoot) => {
        const adapter = adapterFor(workspaceRoot);
        let getterRan = false;
        const command: Record<string, unknown> = {};
        Object.defineProperty(command, "contextName", {
          enumerable: true,
          get() {
            getterRan = true;
            throw new Error("getter must never be invoked");
          },
        });
        command.adapterName = "PaymentAdapter";
        command.portName = "PaymentPort";
        const result = await adapter.removeAdapter(
          command as unknown as Parameters<
            ManifestWriteAdapter["removeAdapter"]
          >[0],
        );
        assert.equal(result.success, false);
        assert.equal(getterRan, false, "getter was invoked");
        if (!result.success) {
          assert.match(msg(result.error), /getter/);
        }
      });
    });

    it("refuses prototype-polluting keys on the command object", async () => {
      await withTempWorkspace(BASE_MANIFEST, async (workspaceRoot) => {
        const adapter = adapterFor(workspaceRoot);
        for (const key of [PROTO_KEY, CONSTRUCTOR_KEY, PROTOTYPE_KEY]) {
          const command: Record<string, unknown> = {
            contextName: "billing",
            adapterName: "PaymentAdapter",
            portName: "PaymentPort",
          };
          // defineProperty, not assignment: plain `obj[key] = v` on __proto__
          // mutates the prototype instead of creating the hostile own key.
          Object.defineProperty(command, key, {
            value: "polluted",
            enumerable: true,
            writable: true,
            configurable: true,
          });
          const result = await adapter.removeAdapter(
            command as unknown as Parameters<
              ManifestWriteAdapter["removeAdapter"]
            >[0],
          );
          assert.equal(result.success, false, `key ${key}`);
          if (!result.success) {
            assert.match(msg(result.error), /prohibited key/);
          }
        }
      });
    });

    it("refuses an array-like command object (missing named fields)", async () => {
      await withTempWorkspace(BASE_MANIFEST, async (workspaceRoot) => {
        const arrayLike = {
          0: "billing",
          1: "PaymentAdapter",
          2: "PaymentPort",
          length: 3,
        };
        const result = await adapterFor(workspaceRoot).removeAdapter(
          arrayLike as unknown as Parameters<
            ManifestWriteAdapter["removeAdapter"]
          >[0],
        );
        assert.equal(result.success, false);
        if (!result.success) {
          assert.match(msg(result.error), /non-blank/);
        }
      });
    });

    it("refuses a non-array manifest collection with a typed error", async () => {
      const manifest = structuredClone(BASE_MANIFEST) as Record<
        string,
        unknown
      >;
      // Replace the array with a plain object — a non-array collection.
      manifest.bounded_contexts = { billing: "oops" };
      await withTempWorkspace(manifest, async (workspaceRoot) => {
        const result = await adapterFor(workspaceRoot).removeAdapter({
          contextName: "billing",
          adapterName: "PaymentAdapter",
          portName: "PaymentPort",
        });
        assert.equal(result.success, false);
        if (!result.success) {
          assert.match(msg(result.error), /array/);
        }
      });
    });

    it("refuses an unreadable or malformed manifest with a typed error", async () => {
      await withTempWorkspace(BASE_MANIFEST, async (workspaceRoot) => {
        const mp = path.join(workspaceRoot, ".architecture", "manifest.yaml");
        await fs.writeFile(mp, "{{{ not yaml", "utf-8");
        const malformed = await adapterFor(workspaceRoot).removeAdapter({
          contextName: "billing",
          adapterName: "PaymentAdapter",
          portName: "PaymentPort",
        });
        assert.equal(malformed.success, false);
        if (!malformed.success) assert.ok(malformed.error instanceof Error);

        await fs.rm(mp);
        const missing = await adapterFor(workspaceRoot).removeDependency({
          sourceModule: "billing",
          targetModule: "shipping",
        });
        assert.equal(missing.success, false);
        if (!missing.success) assert.ok(missing.error instanceof Error);
      });
    });

    it("refuses a write to a split (v2.0 index) manifest", async () => {
      // Fixture matching IndexManifestSchema, with per-context files so the
      // merge succeeds — the refusal must come from the on-disk split guard,
      // not an earlier read failure.
      const splitManifest = {
        version: "2.0",
        description: "split manifest fixture",
        bounded_contexts: ["billing", "shipping"].map((name) => ({
          name,
          type: "core",
          plane: "core",
          status: "active",
          file: `contexts/core/${name}/context.yaml`,
        })),
      };
      await withTempWorkspace(splitManifest, async (workspaceRoot) => {
        for (const name of ["billing", "shipping"]) {
          const coreDir = path.join(
            workspaceRoot,
            ".architecture",
            "contexts",
            "core",
            name,
          );
          await fs.mkdir(coreDir, { recursive: true });
          await fs.writeFile(
            path.join(coreDir, "context.yaml"),
            // Full layer shape so the referential checks pass and execution
            // reaches the write guard.
            yaml.dump({
              name,
              type: "core",
              layers: {
                domain: {},
                application: { ports: { in: [], out: ["PaymentPort"] } },
                infrastructure: { adapters: ["PaymentAdapter"] },
              },
            }),
            "utf-8",
          );
        }
        const result = await adapterFor(workspaceRoot).removeAdapter({
          contextName: "billing",
          adapterName: "PaymentAdapter",
          portName: "PaymentPort",
        });
        assert.equal(result.success, false);
        if (result.success) return;
        assert.match(msg(result.error), /split/);
      });
    });

    it("readPendingMutation returns null for hostile pending-mutation payloads", () => {
      // non-object / null / wrong primitive
      for (const raw of [null, undefined, 42, "remove-adapter", []]) {
        assert.equal(
          readPendingMutation(
            minimalTx({ [PENDING_MANIFEST_MUTATION_KEY]: raw }),
          ),
          null,
          String(raw),
        );
      }
      // getter on kind (never invoked)
      const getterRecord: Record<string, unknown> = {};
      Object.defineProperty(getterRecord, "kind", {
        enumerable: true,
        get() {
          throw new Error("kind getter must never be invoked");
        },
      });
      getterRecord.input = {};
      assert.equal(
        readPendingMutation(
          minimalTx({ [PENDING_MANIFEST_MUTATION_KEY]: getterRecord }),
        ),
        null,
      );
      // prototype-polluting keys (defineProperty: plain assignment on
      // __proto__ mutates the prototype instead of creating an own key)
      for (const key of [PROTO_KEY, CONSTRUCTOR_KEY, PROTOTYPE_KEY]) {
        const rec: Record<string, unknown> = { kind: "remove-adapter" };
        Object.defineProperty(rec, key, {
          value: "polluted",
          enumerable: true,
          writable: true,
          configurable: true,
        });
        assert.equal(
          readPendingMutation(
            minimalTx({ [PENDING_MANIFEST_MUTATION_KEY]: rec }),
          ),
          null,
          key,
        );
      }
    });

    it("readPendingMutation accepts a valid remove-adapter payload", () => {
      const input: PendingRemoveAdapterInput = {
        context_name: "billing",
        adapter_name: "PaymentAdapter",
        port_name: "PaymentPort",
      };
      const mutation = readPendingMutation(
        minimalTx({
          [PENDING_MANIFEST_MUTATION_KEY]: {
            kind: "remove-adapter",
            input,
          },
        }),
      );
      assert.notEqual(mutation, null);
      assert.equal(mutation?.kind, "remove-adapter");
    });

    it("readPendingMutation refuses a nested input getter that returns an allowed context first and a different one second, without invoking it or writing", async () => {
      // time-of-check/time-of-use: a getter on input.context_name could
      // return "billing" (allowed by the grant) when approval reads it and
      // "secret" when applyRemoveAdapter re-reads it. The reader must refuse
      // it up front, never invoke it, and leave nothing to apply.
      let getterRan = 0;
      let call = 0;
      const record: Record<string, unknown> = { kind: "remove-adapter" };
      const input: Record<string, unknown> = {
        adapter_name: "PaymentAdapter",
        port_name: "PaymentPort",
      };
      Object.defineProperty(input, "context_name", {
        enumerable: true,
        get() {
          getterRan++;
          call++;
          return call === 1 ? "billing" : "secret";
        },
      });
      record.input = input;
      const mutation = readPendingMutation(
        minimalTx({ [PENDING_MANIFEST_MUTATION_KEY]: record }),
      );
      assert.equal(mutation, null, "split-reading getter must be refused");
      assert.equal(getterRan, 0, "getter was invoked during read");
      // Nothing to apply: the write port is never reached.
      const write = new WriteSpy();
      if (mutation !== null) {
        await applyPendingManifestMutation(mutation, makePorts(write));
      }
      assert.deepEqual(write.calls, [], "a write escaped the refusal");
    });

    it("readPendingMutation refuses prototype-polluting keys on the nested input", () => {
      for (const key of [PROTO_KEY, CONSTRUCTOR_KEY, PROTOTYPE_KEY]) {
        const input: Record<string, unknown> = {
          context_name: "billing",
          adapter_name: "PaymentAdapter",
          port_name: "PaymentPort",
        };
        Object.defineProperty(input, key, {
          value: "polluted",
          enumerable: true,
          writable: true,
          configurable: true,
        });
        assert.equal(
          readPendingMutation(
            minimalTx({
              [PENDING_MANIFEST_MUTATION_KEY]: {
                kind: "remove-adapter",
                input,
              },
            }),
          ),
          null,
          key,
        );
      }
    });

    it("readPendingMutation refuses an oversized string on the nested input", () => {
      const mutation = readPendingMutation(
        minimalTx({
          [PENDING_MANIFEST_MUTATION_KEY]: {
            kind: "remove-dependency",
            input: {
              source_module: "x".repeat(5000),
              target_module: "shipping",
            },
          },
        }),
      );
      assert.equal(mutation, null);
    });

    it("readPendingMutation returns a frozen plain snapshot, not the original input object", () => {
      const original = {
        context_name: "billing",
        adapter_name: "PaymentAdapter",
        port_name: "PaymentPort",
      };
      const mutation = readPendingMutation(
        minimalTx({
          [PENDING_MANIFEST_MUTATION_KEY]: {
            kind: "remove-adapter",
            input: original,
          },
        }),
      );
      assert.notEqual(mutation, null);
      if (mutation === null || mutation.kind !== "remove-adapter") return;
      // Snapshot, not alias: mutating the original afterwards cannot change
      // what approval and application read.
      assert.notEqual(mutation.input, original);
      assert.equal(Object.isFrozen(mutation.input), true);
      assert.deepEqual(mutation.input, original);
    });

    it("readPendingMutation refuses an array element that is a getter, without invoking it", () => {
      let getterRuns = 0;
      const tags: unknown[] = [];
      Object.defineProperty(tags, "0", {
        enumerable: true,
        get() {
          getterRuns++;
          return "getter-value";
        },
      });
      tags[1] = "plain";
      const mutation = readPendingMutation(
        minimalTx({
          [PENDING_MANIFEST_MUTATION_KEY]: {
            kind: "remove-adapter",
            input: {
              context_name: "billing",
              adapter_name: "PaymentAdapter",
              port_name: "PaymentPort",
              tags,
            },
          },
        }),
      );
      assert.equal(mutation, null, "accessor array element must be refused");
      assert.equal(getterRuns, 0, "array element getter was invoked");
    });

    it("readPendingMutation snapshots a valid array element-wise and freezes the copy", () => {
      const mutation = readPendingMutation(
        minimalTx({
          [PENDING_MANIFEST_MUTATION_KEY]: {
            kind: "remove-adapter",
            input: {
              context_name: "billing",
              adapter_name: "PaymentAdapter",
              port_name: "PaymentPort",
              tags: ["a", "b"],
            },
          },
        }),
      );
      assert.notEqual(mutation, null);
      if (mutation === null || mutation.kind !== "remove-adapter") return;
      const tags = (mutation.input as unknown as Record<string, unknown>).tags;
      assert.deepEqual(tags, ["a", "b"]);
      assert.equal(Object.isFrozen(tags), true, "array snapshot is frozen");
    });

    it("readPendingMutation refuses an array with a hole", () => {
      const tags: unknown[] = ["a", "b"];
      delete tags[0]; // sparse array — index 0 is a hole
      const mutation = readPendingMutation(
        minimalTx({
          [PENDING_MANIFEST_MUTATION_KEY]: {
            kind: "remove-adapter",
            input: {
              context_name: "billing",
              adapter_name: "PaymentAdapter",
              port_name: "PaymentPort",
              tags,
            },
          },
        }),
      );
      assert.equal(mutation, null, "a hole must be refused");
    });

    it("refuses a non-plain-prototype command (inherited getter never invoked)", async () => {
      await withTempWorkspace(BASE_MANIFEST, async (workspaceRoot) => {
        const adapter = adapterFor(workspaceRoot);
        let getterRan = 0;
        const proto = {} as Record<string, unknown>;
        Object.defineProperty(proto, "contextName", {
          enumerable: true,
          get() {
            getterRan++;
            return "billing";
          },
        });
        const command = Object.create(proto) as Record<string, unknown>;
        // Valid own fields — the refusal must come from the prototype, and
        // the inherited getter must never run.
        command.adapterName = "PaymentAdapter";
        command.portName = "PaymentPort";
        const result = await adapter.removeAdapter(
          command as unknown as Parameters<
            ManifestWriteAdapter["removeAdapter"]
          >[0],
        );
        assert.equal(result.success, false);
        if (!result.success) {
          assert.match(msg(result.error), /Invalid command/);
        }
        assert.equal(getterRan, 0, "inherited getter was invoked");
      });
    });
  });

  describe("grant approval for the new pending-mutation kinds", () => {
    it("remove-adapter and remove-dependency derive the same-shaped MutationRef as the create kinds and pass grant approval", () => {
      const removeAdapterMutation = {
        kind: "remove-adapter" as const,
        input: {
          context_name: "billing",
          adapter_name: "PaymentAdapter",
          port_name: "PaymentPort",
        } satisfies PendingRemoveAdapterInput,
      };
      const removeDependencyMutation = {
        kind: "remove-dependency" as const,
        input: {
          source_module: "billing",
          target_module: "shipping",
        } satisfies PendingRemoveDependencyInput,
      };

      const adapterRef = deriveMutationRef(removeAdapterMutation);
      assert.equal(adapterRef.tool, "hexagen_remove_adapter");
      assert.equal(adapterRef.context, "billing");
      const dependencyRef = deriveMutationRef(removeDependencyMutation);
      assert.equal(dependencyRef.tool, "hexagen_remove_dependency");
      // add-dependency's convention: the source side owns the write.
      assert.equal(dependencyRef.context, "billing");

      // Same grant and approval path as the create kinds: tool+context
      // allowlists, the manifest write path, and the file cap all check.
      const okAdapter = checkMutationAgainstGrant(
        grant(),
        adapterRef,
        removeAdapterMutation,
      );
      assert.deepEqual(okAdapter, { allowed: true });
      const okDependency = checkMutationAgainstGrant(
        grant(),
        dependencyRef,
        removeDependencyMutation,
      );
      assert.deepEqual(okDependency, { allowed: true });

      // And the deny path fires for a context outside the grant.
      const outsideInput = {
        context_name: "secret",
        adapter_name: "A",
        port_name: "P",
      };
      const outside = checkMutationAgainstGrant(
        grant(),
        deriveMutationRef({
          kind: "remove-adapter",
          input: outsideInput,
        }),
        { kind: "remove-adapter", input: outsideInput },
      );
      assert.equal(outside.allowed, false);
      if (!outside.allowed) {
        assert.equal(outside.code, "grant_denied");
      }
    });
  });

  describe("applyPendingManifestMutation for the new kinds", () => {
    it("remove-adapter calls the write port and publishes AdapterRemoved when removed is true", async () => {
      const events = new EventBusFake();
      const write = new WriteSpy();
      const applied = await applyPendingManifestMutation(
        {
          kind: "remove-adapter",
          input: {
            context_name: "billing",
            adapter_name: "PaymentAdapter",
            port_name: "PaymentPort",
          },
        },
        makePorts(write, events),
      );
      assert.deepEqual(write.calls, ["removeAdapter"]);
      assert.match(applied.message, /PaymentAdapter removed from billing/);
      assert.equal(events.published.length, 1);
      assert.equal(events.published[0]?.type, "AdapterRemoved");
      assert.deepEqual(events.published[0]?.payload, {
        contextName: "billing",
        adapterName: "PaymentAdapter",
        portName: "PaymentPort",
      });
    });

    it("remove-dependency publishes DependencyRemoved only when removed is true", async () => {
      const events = new EventBusFake();
      const write = new WriteSpy();
      write.removeDependencyResult = {
        success: true,
        value: { removed: false },
      };
      const applied = await applyPendingManifestMutation(
        {
          kind: "remove-dependency",
          input: { source_module: "billing", target_module: "shipping" },
        },
        makePorts(write, events),
      );
      assert.deepEqual(write.calls, ["removeDependency"]);
      assert.match(applied.message, /was not found/);
      assert.equal(events.published.length, 0, "no event for removed:false");
    });

    it("applyPendingManifestMutation surfaces a write-port failure as a thrown error", async () => {
      const write = new WriteSpy();
      write.removeAdapterResult = {
        success: false,
        error: new Error("manifest write exploded"),
      };
      await assert.rejects(
        async () =>
          applyPendingManifestMutation(
            {
              kind: "remove-adapter",
              input: {
                context_name: "billing",
                adapter_name: "PaymentAdapter",
                port_name: "PaymentPort",
              },
            },
            makePorts(write),
          ),
        /manifest write exploded/,
      );
    });

    it("applyPendingManifestMutation refuses a missing write-port method by name", async () => {
      const partial = {
        validateDependency: async () => ({
          success: true as const,
          value: { valid: true, errors: [] },
        }),
      };
      await assert.rejects(
        async () =>
          applyPendingManifestMutation(
            {
              kind: "remove-adapter",
              input: {
                context_name: "billing",
                adapter_name: "PaymentAdapter",
                port_name: "PaymentPort",
              },
            },
            makePorts(partial as unknown as ManifestWritePort),
          ),
        /ManifestWritePort\.removeAdapter is not available/,
      );
      await assert.rejects(
        async () =>
          applyPendingManifestMutation(
            {
              kind: "remove-dependency",
              input: { source_module: "billing", target_module: "shipping" },
            },
            makePorts(partial as unknown as ManifestWritePort),
          ),
        /ManifestWritePort\.removeDependency is not available/,
      );
    });
  });
});

describe("pending-mutation snapshot keeps undefined data values (fail-closed fix, part a)", () => {
  it("keeps an own data property whose value is undefined instead of refusing the whole mutation", () => {
    // Tool handlers set optional fields this way (create-context always
    // writes `description: a.description as string | undefined`), so this
    // shape must never be a refusal.
    const mutation = readPendingMutation(
      minimalTx({
        [PENDING_MANIFEST_MUTATION_KEY]: {
          kind: "remove-adapter",
          input: {
            context_name: "billing",
            adapter_name: "PaymentAdapter",
            port_name: "PaymentPort",
            description: undefined,
          },
        },
      }),
    );
    assert.notEqual(
      mutation,
      null,
      "an undefined-valued own data property must not be treated as a refusal",
    );
    if (mutation === null || mutation.kind !== "remove-adapter") return;
    const input = mutation.input as unknown as Record<string, unknown>;
    assert.equal(input.description, undefined);
    assert.deepEqual(input.context_name, "billing");
  });

  it("keeps an explicit undefined array element instead of refusing the mutation", () => {
    const mutation = readPendingMutation(
      minimalTx({
        [PENDING_MANIFEST_MUTATION_KEY]: {
          kind: "remove-adapter",
          input: {
            context_name: "billing",
            adapter_name: "PaymentAdapter",
            port_name: "PaymentPort",
            tags: ["a", undefined],
          },
        },
      }),
    );
    assert.notEqual(mutation, null);
    if (mutation === null || mutation.kind !== "remove-adapter") return;
    const tags = (mutation.input as unknown as Record<string, unknown>)
      .tags as unknown[];
    assert.equal(tags.length, 2);
    assert.equal(tags[0], "a");
    assert.equal(tags[1], undefined);
  });

  it("exposes the three-case read: absent, refused, and ok", () => {
    // absent — no pending key at all.
    assert.deepEqual(readPendingMutationStatus(minimalTx({})), {
      status: "absent",
    });
    // refused — key present, reader refuses (getter on input).
    const hostile: Record<string, unknown> = { kind: "remove-adapter" };
    Object.defineProperty(hostile, "input", {
      enumerable: true,
      get() {
        throw new Error("input getter must never be invoked");
      },
    });
    assert.deepEqual(
      readPendingMutationStatus(
        minimalTx({ [PENDING_MANIFEST_MUTATION_KEY]: hostile }),
      ),
      { status: "refused" },
    );
    // ok — a valid payload round-trips through the ok arm.
    const ok = readPendingMutationStatus(
      minimalTx({
        [PENDING_MANIFEST_MUTATION_KEY]: {
          kind: "remove-adapter",
          input: {
            context_name: "billing",
            adapter_name: "PaymentAdapter",
            port_name: "PaymentPort",
          },
        },
      }),
    );
    assert.equal(ok.status, "ok");
    if (ok.status === "ok") {
      assert.equal(ok.mutation.kind, "remove-adapter");
    }
    // The typed refusal the accept path returns on the "refused" arm.
    assert.equal(
      new PendingMutationRefusedError("test").name,
      "PendingMutationRefusedError",
    );
  });
});

describe("removeAdapter / removeDependency on a context or module missing the collection (fail-closed fix, part 2)", () => {
  it("removeAdapter on a context with no infrastructure.adapters returns the typed not-found refusal, not 'must be an array'", async () => {
    const manifest = {
      version: "1.0",
      bounded_contexts: [
        {
          name: "bare",
          type: "core",
          description: "",
          // Port declared, but no infrastructure layer / adapters key at
          // all — the adapters lookup must behave like an empty list.
          layers: {
            domain: {},
            application: { ports: { in: [], out: ["PaymentPort"] } },
          },
        },
      ],
    };
    await withTempWorkspace(manifest, async (workspaceRoot) => {
      const result = await adapterFor(workspaceRoot).removeAdapter({
        contextName: "bare",
        adapterName: "MissingAdapter",
        portName: "PaymentPort",
      });
      assert.equal(result.success, false);
      if (result.success) return;
      // Same refusal shape as a context whose adapters list exists but does
      // not contain the item — never an "adapters ... must be an array" error.
      assert.match(
        msg(result.error),
        /Adapter not found in context bare: MissingAdapter/,
      );
      assert.doesNotMatch(msg(result.error), /must be an array/);
    });
  });

  it("removeDependency on a module with no depends_on returns the typed not-found refusal, not 'must be an array'", async () => {
    // BASE_MANIFEST's "shipping" carries no depends_on key at all.
    await withTempWorkspace(BASE_MANIFEST, async (workspaceRoot) => {
      const result = await adapterFor(workspaceRoot).removeDependency({
        sourceModule: "shipping",
        targetModule: "billing",
      });
      assert.equal(result.success, false);
      if (result.success) return;
      assert.match(
        msg(result.error),
        /Dependency not found: shipping does not depend on billing/,
      );
      assert.doesNotMatch(msg(result.error), /must be an array/);
    });
  });
});

describe("accept fail-closed through the tool handler (fail-closed fix, part b)", () => {
  const NOW = new Date("2026-11-25T12:00:00.000Z");

  class TraceLineSpy implements TraceWritePort {
    lines: Array<{ halt_reason: string; tool: string }> = [];
    async appendGrantMissing(
      input: GrantMissingAppendInput,
    ): Promise<Result<void, Error>> {
      this.lines.push({ halt_reason: "grant_missing", tool: input.tool });
      return { success: true, value: undefined };
    }
    async appendLine(input: TraceAppendInput): Promise<Result<void, Error>> {
      this.lines.push({
        halt_reason: input.halt_reason,
        tool: input.tool_call.name,
      });
      return { success: true, value: undefined };
    }
  }

  class ScaffoldingOk implements ScaffoldingPort {
    async scaffoldModule(): Promise<Result<{ filesCreated: string[] }>> {
      return { success: true, value: { filesCreated: ["src/payments/index.ts"] } };
    }
    async createPort(): Promise<Result<{ fileCreated: string }>> {
      throw new Error("createPort must not be called by these mutations");
    }
    async createAdapter(): Promise<Result<{ fileCreated: string }>> {
      throw new Error("createAdapter must not be called by these mutations");
    }
    async deleteCreatedFiles(
      paths: string[],
    ): Promise<Result<{ deleted: string[] }>> {
      return { success: true, value: { deleted: [...paths] } };
    }
  }

  class AlwaysVerifiedSignature implements GrantSignaturePort {
    async verify(): Promise<Result<boolean, Error>> {
      return { success: true, value: true };
    }
  }

  function handlerHarness() {
    const tm = new InMemoryTransactionManager();
    const write = new WriteSpy();
    const trace = new TraceLineSpy();
    const accept = new AcceptTransactionToolUseCase(
      tm,
      write,
      new ScaffoldingOk(),
      new EventBusFake(),
      trace,
      new AlwaysVerifiedSignature(),
      () => NOW,
    );
    const deps = {
      createContextToolUseCase: new CreateContextToolUseCase(tm),
      scaffoldModuleToolUseCase: new ScaffoldModuleToolUseCase(tm),
      acceptTransactionToolUseCase: accept,
    } as unknown as MCPServerAdapterDependencies;
    return { tm, write, trace, deps };
  }

  function acceptGrant(overrides: Partial<Grant> = {}): Grant {
    return {
      id: "grant-accept",
      principal: "martin",
      agent: "agent-1",
      contexts: ["billing"],
      paths: [MANIFEST_WRITE_PATH],
      tools: [
        "hexagen_create_context",
        "hexagen_scaffold_module",
        "hexagen_remove_dependency",
      ],
      mode: "write",
      expires_at: "2099-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  async function proposeViaHandler(
    tool: string,
    args: Record<string, unknown>,
    deps: MCPServerAdapterDependencies,
  ): Promise<string> {
    const proposal = await toolRegistry.get(tool)!.handler(args, deps);
    assert.ok(!proposal.isError, `proposal failed: ${proposal.content[0]?.text}`);
    const output = JSON.parse(proposal.content[0]!.text) as {
      transactionId?: string;
    };
    assert.ok(output.transactionId, "proposal must carry a transactionId");
    return output.transactionId!;
  }

  it("hexagen_create_context {name, type} with no description is APPLIED under an in-scope grant", async () => {
    const { tm, write, trace, deps } = handlerHarness();
    // The create-context handler always sets `description: undefined` on its
    // input — exactly the shape that used to null the snapshot and fail open.
    const txId = await proposeViaHandler(
      "hexagen_create_context",
      { name: "billing", type: "core" },
      deps,
    );
    const result = await toolRegistry
      .get("hexagen_accept_transaction")!
      .handler({ transaction_id: txId, grant: acceptGrant() }, deps);
    assert.ok(!result.isError, `accept failed: ${result.content[0]?.text}`);
    assert.deepEqual(write.calls, ["registerBoundedContext"]);
    assert.equal(trace.lines[0]?.halt_reason, "completed");
    assert.equal(trace.lines[0]?.tool, "hexagen_create_context");
    assert.equal(tm.get(txId)?.status, "committed");
  });

  it("the same mutation under an out-of-scope grant is DENIED and not applied", async () => {
    const { tm, write, trace, deps } = handlerHarness();
    const txId = await proposeViaHandler(
      "hexagen_create_context",
      { name: "billing", type: "core" },
      deps,
    );
    const result = await toolRegistry
      .get("hexagen_accept_transaction")!
      .handler(
        { transaction_id: txId, grant: acceptGrant({ contexts: ["elsewhere"] }) },
        deps,
      );
    assert.equal(result.isError, true);
    assert.match(String(result.content[0]?.text), /context 'billing'/);
    assert.deepEqual(write.calls, [], "no write may escape a denied accept");
    assert.equal(trace.lines[0]?.halt_reason, "grant_denied");
    assert.equal(tm.get(txId)?.status, "pending");
  });

  it("hexagen_scaffold_module with context_type undefined is APPLIED under an in-scope grant", async () => {
    const { tm, write, trace, deps } = handlerHarness();
    const txId = await proposeViaHandler(
      "hexagen_scaffold_module",
      { name: "payments", layer: "domain" },
      deps,
    );
    const result = await toolRegistry
      .get("hexagen_accept_transaction")!
      .handler(
        { transaction_id: txId, grant: acceptGrant({ contexts: ["payments"], paths: [MANIFEST_WRITE_PATH, "packages/payments/"] }) },
        deps,
      );
    assert.ok(!result.isError, `accept failed: ${result.content[0]?.text}`);
    assert.deepEqual(write.calls, ["registerBoundedContext"]);
    assert.equal(trace.lines[0]?.halt_reason, "completed");
    assert.equal(tm.get(txId)?.status, "committed");
  });

  it("an oversized string on an existing kind is DENIED, never silently committed, and accept never reports success", async () => {
    const { tm, write, trace, deps } = handlerHarness();
    const tx = tm.begin("mcp:oversized", {
      [PENDING_MANIFEST_MUTATION_KEY]: {
        kind: "remove-dependency",
        input: {
          source_module: "x".repeat(5000),
          target_module: "shipping",
        },
      },
    });
    const result = await toolRegistry
      .get("hexagen_accept_transaction")!
      .handler({ transaction_id: tx.id, grant: acceptGrant() }, deps);
    assert.equal(
      result.isError,
      true,
      "accept must never report success when a pending key was refused",
    );
    assert.match(
      String(result.content[0]?.text),
      /refused by the snapshot reader/,
    );
    assert.deepEqual(write.calls, [], "no write may escape a refused pending");
    assert.equal(trace.lines[0]?.halt_reason, "grant_denied");
    assert.notEqual(trace.lines[0]?.halt_reason, "completed");
    assert.equal(
      tm.get(tx.id)?.status,
      "pending",
      "the transaction must not be committed",
    );
  });
});
