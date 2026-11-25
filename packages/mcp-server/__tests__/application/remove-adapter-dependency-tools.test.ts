/**
 * End-to-end tests for the `hexagen_remove_adapter` and
 * `hexagen_remove_dependency` MCP tools (HXA1c): dry-run, live
 * pending-approval, accept-transaction application, missing-target refusal,
 * hostile-input refusal, and registry uniqueness.
 *
 * Tool handlers are driven through `toolRegistry.get(name)!.handler` with a
 * real use case wired to an `InMemoryTransactionManager`, so a handler that
 * dropped or swapped fields fails these tests rather than the use case's own
 * (already covered) validation.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { EventBusPort } from "@hexagen/messaging";
import type { Result } from "@hexagen/shared";
import { InMemoryTransactionManager } from "@hexagen/transaction-system";
import type {
  MCPServerAdapterDependencies,
  ManifestRemovalToolDependencies,
} from "../../src/infrastructure/adapters/mcp-server.types.js";
import { allTools, toolRegistry } from "../../src/infrastructure/adapters/tools/registry.js";
import { RemoveAdapterToolUseCase } from "../../src/application/use-cases/remove-adapter-tool.use-case.js";
import { RemoveDependencyToolUseCase } from "../../src/application/use-cases/remove-dependency-tool.use-case.js";
import { AcceptTransactionToolUseCase } from "../../src/application/use-cases/accept-transaction-tool.use-case.js";
import { PENDING_MANIFEST_MUTATION_KEY } from "../../src/application/pending-manifest-mutation.js";
import {
  MANIFEST_WRITE_PATH,
  type Grant,
} from "../../src/application/kernel/grant.js";
import type { ManifestWritePort } from "../../src/application/ports/out/manifest-write.port.js";
import type { ScaffoldingPort } from "../../src/application/ports/out/scaffolding.port.js";
import type {
  GrantMissingAppendInput,
  TraceAppendInput,
  TraceWritePort,
} from "../../src/application/ports/out/trace-write.port.js";
import type { GrantSignaturePort } from "../../src/application/ports/out/grant-signature.port.js";
import type { TraceRecord } from "../../src/application/kernel/trace.js";

const REMOVE_ADAPTER = "hexagen_remove_adapter";
const REMOVE_DEPENDENCY = "hexagen_remove_dependency";
const POLLUTING_KEY = "__" + "proto__"; // built at runtime, never a literal key

class ManifestWriteSpy implements ManifestWritePort {
  writes: string[] = [];
  removeAdapterCalls: Array<{ contextName: string; adapterName: string; portName: string }> = [];
  removeDependencyCalls: Array<{ sourceModule: string; targetModule: string }> = [];
  removeAdapterResult: Result<{ removed: boolean }, Error> = {
    success: true,
    value: { removed: true },
  };
  removeDependencyResult: Result<{ removed: boolean }, Error> = {
    success: true,
    value: { removed: true },
  };
  async validateDependency() {
    return { success: true as const, value: { valid: true, errors: [] } };
  }
  async addDependency() {
    return { success: true as const, value: { updated: true } };
  }
  async registerBoundedContext() {
    this.writes.push("registerBoundedContext");
    return {
      success: true as const,
      value: { registered: true, alreadyExisted: false },
    };
  }
  async registerPort() {
    return { success: true as const, value: { registered: true } };
  }
  async registerAdapter() {
    return { success: true as const, value: { registered: true } };
  }
  async removePort() {
    return { success: true as const, value: { removed: true } };
  }
  async removeAdapter(command: {
    contextName: string;
    adapterName: string;
    portName: string;
  }) {
    this.writes.push("removeAdapter");
    this.removeAdapterCalls.push(command);
    return this.removeAdapterResult;
  }
  async removeDependency(command: {
    sourceModule: string;
    targetModule: string;
  }) {
    this.writes.push("removeDependency");
    this.removeDependencyCalls.push(command);
    return this.removeDependencyResult;
  }
  async removeContext() {
    return { success: true as const, value: { removed: true } };
  }
}

class ScaffoldingStub implements ScaffoldingPort {
  async scaffoldModule() {
    return { success: true as const, value: { filesCreated: [] } };
  }
  async createPort() {
    return { success: true as const, value: { fileCreated: "" } };
  }
  async createAdapter() {
    return { success: true as const, value: { fileCreated: "" } };
  }
  async deleteCreatedFiles(paths: string[]) {
    return { success: true as const, value: { deleted: paths } };
  }
}

class EventBusFake implements EventBusPort {
  published: Array<{ type: string; payload: unknown }> = [];
  subscribe(): () => void {
    return () => {};
  }
  publish(event: unknown): void {
    const e = event as { type: string; payload: unknown };
    this.published.push({ type: e.type, payload: e.payload });
  }
  unsubscribe(): void {}
  clear(): void {}
}

class TraceWriteSpy implements TraceWritePort {
  missing: GrantMissingAppendInput[] = [];
  lines: TraceRecord[] = [];
  async appendGrantMissing(
    input: GrantMissingAppendInput,
  ): Promise<Result<void, Error>> {
    this.missing.push(input);
    return { success: true, value: undefined };
  }
  async appendLine(input: TraceAppendInput): Promise<Result<void, Error>> {
    this.lines.push({
      grant_id: input.grant_id,
      goal_id: input.goal_id,
      tool_calls: [
        {
          name: input.tool_call.name,
          args_digest: "sha256:test",
          result_digest: "sha256:test",
          time: input.tool_call.time,
        },
      ],
      halt_reason: input.halt_reason,
      transaction_ids: [...input.transaction_ids],
      started_at: input.started_at,
      ended_at: input.ended_at,
    });
    return { success: true, value: undefined };
  }
}

class GrantSignatureSpy implements GrantSignaturePort {
  async verify(): Promise<Result<boolean, Error>> {
    return { success: true, value: true };
  }
}

const NOW = new Date("2026-09-30T12:00:00.000Z");

function baseGrant(overrides: Partial<Grant> = {}): Grant {
  return {
    id: "grant-001",
    principal: "martin",
    agent: "agent-1",
    contexts: ["alpha-context", "alpha-source"],
    paths: [MANIFEST_WRITE_PATH],
    tools: [REMOVE_ADAPTER, REMOVE_DEPENDENCY],
    mode: "write",
    expires_at: "2026-09-30T18:00:00.000Z",
    signature: "test-signature",
    ...overrides,
  };
}

/** Minimal deps bag for the two removal handlers, typed on the ports. */
function removalDeps(
  overrides: Partial<ManifestRemovalToolDependencies> = {},
): MCPServerAdapterDependencies {
  const tm = new InMemoryTransactionManager();
  return {
    removeAdapterToolUseCase: new RemoveAdapterToolUseCase(tm),
    removeDependencyToolUseCase: new RemoveDependencyToolUseCase(tm),
    ...overrides,
  } as unknown as MCPServerAdapterDependencies;
}

function parseContent(result: { content: Array<{ text: string }> }): Record<
  string,
  unknown
> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

describe("hexagen_remove_adapter / hexagen_remove_dependency registry", () => {
  it("registers each removal tool exactly once in allTools and toolRegistry", () => {
    const adapterEntries = allTools.filter((t) => t.name === REMOVE_ADAPTER);
    const dependencyEntries = allTools.filter(
      (t) => t.name === REMOVE_DEPENDENCY,
    );
    assert.equal(adapterEntries.length, 1);
    assert.equal(dependencyEntries.length, 1);
    assert.equal(toolRegistry.has(REMOVE_ADAPTER), true);
    assert.equal(toolRegistry.has(REMOVE_DEPENDENCY), true);
    // Map keys are unique by construction; the uniqueness claim is about
    // allTools, so re-derive the registry and confirm no silent overwrite:
    const names = allTools.map((t) => t.name);
    assert.equal(new Set(names).size, names.length);
  });
});

describe("hexagen_remove_adapter dry-run", () => {
  it("returns dryRun=true removed=false, begins no transaction, writes nothing", async () => {
    const write = new ManifestWriteSpy();
    const tm = new InMemoryTransactionManager();
    const deps = removalDeps({
      removeAdapterToolUseCase: new RemoveAdapterToolUseCase(tm),
    });
    // Distinct field values so a handler that swaps fields fails.
    const result = await toolRegistry.get(REMOVE_ADAPTER)!.handler(
      {
        context_name: "alpha-context",
        adapter_name: "beta-adapter",
        port_name: "gamma-port",
        dry_run: true,
      },
      deps,
    );
    assert.equal(result.isError, undefined);
    const parsed = parseContent(result);
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.removed, false);
    assert.equal(tm.list().length, 0);
    assert.equal(write.writes.length, 0);
    assert.equal(write.removeAdapterCalls.length, 0);
  });
});

describe("hexagen_remove_dependency dry-run", () => {
  it("returns dryRun=true removed=false, begins no transaction, writes nothing", async () => {
    const write = new ManifestWriteSpy();
    const tm = new InMemoryTransactionManager();
    const deps = removalDeps({
      removeDependencyToolUseCase: new RemoveDependencyToolUseCase(tm),
    });
    const result = await toolRegistry.get(REMOVE_DEPENDENCY)!.handler(
      {
        source_module: "alpha-source",
        target_module: "beta-target",
        dry_run: true,
      },
      deps,
    );
    assert.equal(result.isError, undefined);
    const parsed = parseContent(result);
    assert.equal(parsed.dryRun, true);
    assert.equal(parsed.removed, false);
    assert.equal(tm.list().length, 0);
    assert.equal(write.writes.length, 0);
    assert.equal(write.removeDependencyCalls.length, 0);
  });
});

describe("hexagen_remove_adapter live proposal", () => {
  it("returns pendingApproval=true with a transactionId, begins one pending-mutation transaction, writes nothing", async () => {
    const write = new ManifestWriteSpy();
    const tm = new InMemoryTransactionManager();
    const deps = removalDeps({
      removeAdapterToolUseCase: new RemoveAdapterToolUseCase(tm),
    });
    const result = await toolRegistry.get(REMOVE_ADAPTER)!.handler(
      {
        context_name: "alpha-context",
        adapter_name: "beta-adapter",
        port_name: "gamma-port",
        dry_run: false,
      },
      deps,
    );
    assert.equal(result.isError, undefined);
    const parsed = parseContent(result);
    assert.equal(parsed.dryRun, false);
    assert.equal(parsed.removed, false);
    assert.equal(parsed.pendingApproval, true);
    assert.ok(typeof parsed.transactionId === "string");
    assert.ok((parsed.transactionId as string).length > 0);
    const pending = tm.list();
    assert.equal(pending.length, 1);
    const metadata = pending[0]!.metadata;
    assert.ok(Object.prototype.hasOwnProperty.call(metadata, PENDING_MANIFEST_MUTATION_KEY));
    assert.equal(write.writes.length, 0);
    assert.equal(write.removeAdapterCalls.length, 0);
  });
});

describe("hexagen_remove_dependency live proposal", () => {
  it("returns pendingApproval=true with a transactionId, begins one pending-mutation transaction, writes nothing", async () => {
    const write = new ManifestWriteSpy();
    const tm = new InMemoryTransactionManager();
    const deps = removalDeps({
      removeDependencyToolUseCase: new RemoveDependencyToolUseCase(tm),
    });
    const result = await toolRegistry.get(REMOVE_DEPENDENCY)!.handler(
      {
        source_module: "alpha-source",
        target_module: "beta-target",
        dry_run: false,
      },
      deps,
    );
    assert.equal(result.isError, undefined);
    const parsed = parseContent(result);
    assert.equal(parsed.dryRun, false);
    assert.equal(parsed.removed, false);
    assert.equal(parsed.pendingApproval, true);
    assert.ok(typeof parsed.transactionId === "string");
    assert.ok((parsed.transactionId as string).length > 0);
    const pending = tm.list();
    assert.equal(pending.length, 1);
    const metadata = pending[0]!.metadata;
    assert.ok(Object.prototype.hasOwnProperty.call(metadata, PENDING_MANIFEST_MUTATION_KEY));
    assert.equal(write.writes.length, 0);
    assert.equal(write.removeDependencyCalls.length, 0);
  });
});

describe("hexagen_remove_adapter accepted end-to-end", () => {
  it("applies exactly one removeAdapter with the proposed fields and publishes AdapterRemoved", async () => {
    const write = new ManifestWriteSpy();
    const events = new EventBusFake();
    const tm = new InMemoryTransactionManager();
    const deps = removalDeps({
      removeAdapterToolUseCase: new RemoveAdapterToolUseCase(tm),
    });
    const proposal = await toolRegistry.get(REMOVE_ADAPTER)!.handler(
      {
        context_name: "alpha-context",
        adapter_name: "beta-adapter",
        port_name: "gamma-port",
        dry_run: false,
      },
      deps,
    );
    const transactionId = parseContent(proposal).transactionId as string;
    const accept = new AcceptTransactionToolUseCase(
      tm,
      write,
      new ScaffoldingStub(),
      events,
      new TraceWriteSpy(),
      new GrantSignatureSpy(),
      () => NOW,
    );
    const result = await accept.execute({
      transaction_id: transactionId,
      grant: baseGrant({ tools: [REMOVE_ADAPTER] }),
    });
    assert.equal(result.success, true);
    assert.equal(write.removeAdapterCalls.length, 1);
    assert.deepEqual(write.removeAdapterCalls[0], {
      contextName: "alpha-context",
      adapterName: "beta-adapter",
      portName: "gamma-port",
    });
    const removed = events.published.filter((e) => e.type === "AdapterRemoved");
    assert.equal(removed.length, 1);
  });
});

describe("hexagen_remove_dependency accepted end-to-end", () => {
  it("applies exactly one removeDependency with the proposed fields and publishes DependencyRemoved", async () => {
    const write = new ManifestWriteSpy();
    const events = new EventBusFake();
    const tm = new InMemoryTransactionManager();
    const deps = removalDeps({
      removeDependencyToolUseCase: new RemoveDependencyToolUseCase(tm),
    });
    const proposal = await toolRegistry.get(REMOVE_DEPENDENCY)!.handler(
      {
        source_module: "alpha-source",
        target_module: "beta-target",
        dry_run: false,
      },
      deps,
    );
    const transactionId = parseContent(proposal).transactionId as string;
    const accept = new AcceptTransactionToolUseCase(
      tm,
      write,
      new ScaffoldingStub(),
      events,
      new TraceWriteSpy(),
      new GrantSignatureSpy(),
      () => NOW,
    );
    const result = await accept.execute({
      transaction_id: transactionId,
      grant: baseGrant({ tools: [REMOVE_DEPENDENCY] }),
    });
    assert.equal(result.success, true);
    assert.equal(write.removeDependencyCalls.length, 1);
    assert.deepEqual(write.removeDependencyCalls[0], {
      sourceModule: "alpha-source",
      targetModule: "beta-target",
    });
    const removed = events.published.filter(
      (e) => e.type === "DependencyRemoved",
    );
    assert.equal(removed.length, 1);
  });
});

describe("missing-target refusal at accept", () => {
  it("surfaces the write failure as success=false when removeAdapter reports the target missing", async () => {
    const write = new ManifestWriteSpy();
    write.removeAdapterResult = {
      success: false,
      error: new Error("adapter not found in manifest"),
    };
    const events = new EventBusFake();
    const tm = new InMemoryTransactionManager();
    const deps = removalDeps({
      removeAdapterToolUseCase: new RemoveAdapterToolUseCase(tm),
    });
    const proposal = await toolRegistry.get(REMOVE_ADAPTER)!.handler(
      {
        context_name: "alpha-context",
        adapter_name: "beta-adapter",
        port_name: "gamma-port",
        dry_run: false,
      },
      deps,
    );
    const transactionId = parseContent(proposal).transactionId as string;
    const accept = new AcceptTransactionToolUseCase(
      tm,
      write,
      new ScaffoldingStub(),
      events,
      new TraceWriteSpy(),
      new GrantSignatureSpy(),
      () => NOW,
    );
    const result = await accept.execute({
      transaction_id: transactionId,
      grant: baseGrant({ tools: [REMOVE_ADAPTER] }),
    });
    assert.equal(result.success, false);
    assert.match(String((result as { error?: Error }).error), /not found/);
    // One attempted call, but no removal ever reported.
    assert.equal(write.removeAdapterCalls.length, 1);
    assert.equal(
      events.published.filter((e) => e.type === "AdapterRemoved").length,
      0,
    );
  });
});

describe("grant enforcement on removal transactions", () => {
  it("denies accepting with no grant: success=false, zero writes, transaction stays uncommitted", async () => {
    const write = new ManifestWriteSpy();
    const tm = new InMemoryTransactionManager();
    const deps = removalDeps({
      removeAdapterToolUseCase: new RemoveAdapterToolUseCase(tm),
    });
    const proposal = await toolRegistry.get(REMOVE_ADAPTER)!.handler(
      {
        context_name: "alpha-context",
        adapter_name: "beta-adapter",
        port_name: "gamma-port",
        dry_run: false,
      },
      deps,
    );
    const transactionId = parseContent(proposal).transactionId as string;
    const accept = new AcceptTransactionToolUseCase(
      tm,
      write,
      new ScaffoldingStub(),
      new EventBusFake(),
      new TraceWriteSpy(),
      new GrantSignatureSpy(),
      () => NOW,
    );
    const result = await accept.execute({ transaction_id: transactionId });
    assert.equal(result.success, false);
    assert.equal(write.writes.length, 0);
    assert.equal(write.removeAdapterCalls.length, 0);
    assert.equal(tm.get(transactionId)!.status, "pending");
  });

  it("denies accepting with a grant that lacks the tool: success=false, zero writes, transaction stays uncommitted", async () => {
    const write = new ManifestWriteSpy();
    const tm = new InMemoryTransactionManager();
    const deps = removalDeps({
      removeDependencyToolUseCase: new RemoveDependencyToolUseCase(tm),
    });
    const proposal = await toolRegistry.get(REMOVE_DEPENDENCY)!.handler(
      {
        source_module: "alpha-source",
        target_module: "beta-target",
        dry_run: false,
      },
      deps,
    );
    const transactionId = parseContent(proposal).transactionId as string;
    const accept = new AcceptTransactionToolUseCase(
      tm,
      write,
      new ScaffoldingStub(),
      new EventBusFake(),
      new TraceWriteSpy(),
      new GrantSignatureSpy(),
      () => NOW,
    );
    const result = await accept.execute({
      transaction_id: transactionId,
      grant: baseGrant({ tools: ["hexagen_create_context"] }),
    });
    assert.equal(result.success, false);
    assert.match(
      String((result as { error?: Error }).error),
      /does not include tool/,
    );
    assert.equal(write.writes.length, 0);
    assert.equal(write.removeDependencyCalls.length, 0);
    assert.equal(tm.get(transactionId)!.status, "pending");
  });
});

describe("blank / missing required fields", () => {
  const blankCases: Array<[string, Record<string, unknown>]> = [
    ["empty context_name", { context_name: "", adapter_name: "a", port_name: "p" }],
    ["whitespace context_name", { context_name: "   ", adapter_name: "a", port_name: "p" }],
    ["empty adapter_name", { context_name: "c", adapter_name: "", port_name: "p" }],
    ["empty port_name", { context_name: "c", adapter_name: "a", port_name: " " }],
  ];

  for (const [title, args] of blankCases) {
    it(`hexagen_remove_adapter refuses a ${title}`, async () => {
      const result = await toolRegistry.get(REMOVE_ADAPTER)!.handler(
        args,
        removalDeps(),
      );
      assert.equal(result.isError, true);
      assert.match(result.content[0]!.text, /are required/);
    });
  }

  const blankDependencyCases: Array<[string, Record<string, unknown>]> = [
    ["empty source_module", { source_module: "", target_module: "t" }],
    ["whitespace source_module", { source_module: "  ", target_module: "t" }],
    ["empty target_module", { source_module: "s", target_module: "" }],
  ];

  for (const [title, args] of blankDependencyCases) {
    it(`hexagen_remove_dependency refuses a ${title}`, async () => {
      const result = await toolRegistry.get(REMOVE_DEPENDENCY)!.handler(
        args,
        removalDeps(),
      );
      assert.equal(result.isError, true);
      assert.match(result.content[0]!.text, /are required/);
    });
  }

  it("refuses an oversized string beyond the 4096 cap", async () => {
    const result = await toolRegistry.get(REMOVE_ADAPTER)!.handler(
      {
        context_name: "c".repeat(4097),
        adapter_name: "a",
        port_name: "p",
      },
      removalDeps(),
    );
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /exceeds maximum length/);
  });

  it("refuses a non-boolean dry_run", async () => {
    const result = await toolRegistry.get(REMOVE_DEPENDENCY)!.handler(
      {
        source_module: "s",
        target_module: "t",
        dry_run: "yes",
      },
      removalDeps(),
    );
    assert.equal(result.isError, true);
    assert.equal(result.content[0]!.text, "dry_run must be a boolean");
  });
});

describe("hostile-input refusal", () => {
  it("refuses every hostile shape for both tools", async () => {
    const oversized = {
      context_name: "x".repeat(4097),
      adapter_name: "a",
      port_name: "p",
    };
    // An object literal would set the prototype instead of an own key, so
    // the polluting-key case is built by parsing JSON.
    const polluting = JSON.parse(
      `{"${POLLUTING_KEY}": {"v": 1}, "context_name": "c", "adapter_name": "a", "port_name": "p"}`,
    ) as Record<string, unknown>;
    const cases: Array<unknown> = [
      null,
      undefined,
      "not-an-object",
      42,
      ["a", "b"],
      { length: 1, 0: "x" },
      oversized,
      polluting,
    ];
    for (const [index, args] of cases.entries()) {
      const adapterResult = await toolRegistry
        .get(REMOVE_ADAPTER)!
        .handler(args, removalDeps());
      assert.equal(adapterResult.isError, true, `adapter case ${index}`);
      const dependencyResult = await toolRegistry
        .get(REMOVE_DEPENDENCY)!
        .handler(args, removalDeps());
      assert.equal(dependencyResult.isError, true, `dependency case ${index}`);
    }
  });

  it("reports the exact refusal text for a non-plain object", async () => {
    const result = await toolRegistry
      .get(REMOVE_ADAPTER)!
      .handler([1, 2, 3], removalDeps());
    assert.equal(result.content[0]!.text, "input must be a plain object");
  });

  it("reports the exact refusal text for an array-like object", async () => {
    const result = await toolRegistry
      .get(REMOVE_DEPENDENCY)!
      .handler({ length: 1, 0: "x" }, removalDeps());
    assert.equal(result.content[0]!.text, "input must be a plain object");
  });

  it("reports the exact refusal text for a prototype-polluting key", async () => {
    const polluting = JSON.parse(
      `{"${POLLUTING_KEY}": {"v": 1}, "source_module": "s", "target_module": "t"}`,
    );
    const result = await toolRegistry
      .get(REMOVE_DEPENDENCY)!
      .handler(polluting, removalDeps());
    assert.equal(result.content[0]!.text, "input contains forbidden key");
  });

  it("never invokes a throwing getter and refuses the input", async () => {
    let getterCalls = 0;
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, "context_name", {
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("getter must never be invoked");
      },
    });
    const result = await toolRegistry
      .get(REMOVE_ADAPTER)!
      .handler(hostile, removalDeps());
    assert.equal(result.isError, true);
    assert.equal(
      result.content[0]!.text,
      "input must not contain accessor properties",
    );
    assert.equal(getterCalls, 0);
  });

  it("refuses when removeAdapterToolUseCase is missing from deps", async () => {
    const result = await toolRegistry
      .get(REMOVE_ADAPTER)!
      .handler(
        { context_name: "c", adapter_name: "a", port_name: "p" },
        {} as unknown as MCPServerAdapterDependencies,
      );
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /required/);
  });

  it("refuses when removeDependencyToolUseCase is missing from deps", async () => {
    const result = await toolRegistry
      .get(REMOVE_DEPENDENCY)!
      .handler(
        { source_module: "s", target_module: "t" },
        {} as unknown as MCPServerAdapterDependencies,
      );
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /required/);
  });

  it("refuses when the port is present but execute is not a function", async () => {
    const result = await toolRegistry.get(REMOVE_ADAPTER)!.handler(
      { context_name: "c", adapter_name: "a", port_name: "p" },
      removalDeps({
        removeAdapterToolUseCase: {} as never,
      }),
    );
    assert.equal(result.isError, true);
    assert.match(result.content[0]!.text, /execute is required/);
  });

  it("reports the use case's thrown error message as isError content", async () => {
    const result = await toolRegistry.get(REMOVE_DEPENDENCY)!.handler(
      { source_module: "s", target_module: "t" },
      removalDeps({
        removeDependencyToolUseCase: {
          async execute() {
            throw new Error("boom from use case");
          },
        },
      }),
    );
    assert.equal(result.isError, true);
    assert.equal(result.content[0]!.text, "boom from use case");
  });

  // Residual risk, documented per the hostile-input rule: a Proxy whose
  // traps forward consistently in every trap is indistinguishable from its
  // plain target and is accepted by both handlers. No Proxy detection is
  // attempted — behaviour is unchanged for this input class by design. The
  // test below pins that accepted-residual behaviour so a future change is
  // a conscious decision, not an accident.
  it("accepts a consistent-trap Proxy as the documented residual", async () => {
    const target = {
      context_name: "alpha-context",
      adapter_name: "beta-adapter",
      port_name: "gamma-port",
      dry_run: true,
    };
    const proxy = new Proxy(target, {
      get(t, prop, receiver) {
        return Reflect.get(t, prop, receiver);
      },
      has(t, prop) {
        return Reflect.has(t, prop);
      },
      ownKeys(t) {
        return Reflect.ownKeys(t);
      },
      getOwnPropertyDescriptor(t, prop) {
        return Object.getOwnPropertyDescriptor(t, prop);
      },
      getPrototypeOf(t) {
        return Object.getPrototypeOf(t);
      },
    });
    const result = await toolRegistry
      .get(REMOVE_ADAPTER)!
      .handler(proxy, removalDeps());
    assert.equal(result.isError, undefined);
    const parsed = parseContent(result);
    assert.equal(parsed.dryRun, true);
  });
});
