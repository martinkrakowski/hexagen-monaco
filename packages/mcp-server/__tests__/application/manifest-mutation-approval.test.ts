/**
 * The seven MCP mutation tools must not write the manifest except via
 * hexagen_accept_transaction. Reject leaves the write port untouched.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { EventBusPort } from "@hexagen/messaging";
import type { Result } from "@hexagen/shared";
import { InMemoryTransactionManager } from "@hexagen/transaction-system";
import { AcceptTransactionToolUseCase } from "../../src/application/use-cases/accept-transaction-tool.use-case.js";
import { AddDependencyToolUseCase } from "../../src/application/use-cases/add-dependency-tool.use-case.js";
import { CreateAdapterToolUseCase } from "../../src/application/use-cases/create-adapter-tool.use-case.js";
import { CreateContextToolUseCase } from "../../src/application/use-cases/create-context-tool.use-case.js";
import { CreatePortToolUseCase } from "../../src/application/use-cases/create-port-tool.use-case.js";
import { RejectTransactionToolUseCase } from "../../src/application/use-cases/reject-transaction-tool.use-case.js";
import { RemoveContextToolUseCase } from "../../src/application/use-cases/remove-context-tool.use-case.js";
import { RemovePortToolUseCase } from "../../src/application/use-cases/remove-port-tool.use-case.js";
import { ScaffoldModuleToolUseCase } from "../../src/application/use-cases/scaffold-module-tool.use-case.js";
import type { ManifestWritePort } from "../../src/application/ports/out/manifest-write.port.js";
import type { ScaffoldingPort } from "../../src/application/ports/out/scaffolding.port.js";

class ManifestWriteSpy implements ManifestWritePort {
  writes: string[] = [];

  async validateDependency() {
    return {
      success: true as const,
      value: { valid: true, errors: [] as string[] },
    };
  }
  async addDependency() {
    this.writes.push("addDependency");
    return { success: true as const, value: { updated: true } };
  }
  async registerBoundedContext(): Promise<
    Result<{ registered: boolean; alreadyExisted: boolean }>
  > {
    this.writes.push("registerBoundedContext");
    return {
      success: true as const,
      value: { registered: true, alreadyExisted: false },
    };
  }
  async registerPort() {
    this.writes.push("registerPort");
    return { success: true as const, value: { registered: true } };
  }
  async registerAdapter() {
    this.writes.push("registerAdapter");
    return { success: true as const, value: { registered: true } };
  }
  async removePort() {
    this.writes.push("removePort");
    return { success: true as const, value: { removed: true } };
  }
  async removeContext() {
    this.writes.push("removeContext");
    return { success: true as const, value: { removed: true } };
  }
}

class ScaffoldingSpy implements ScaffoldingPort {
  writes: string[] = [];
  async scaffoldModule() {
    this.writes.push("scaffoldModule");
    return {
      success: true as const,
      value: { filesCreated: ["packages/x/src/index.ts"] },
    };
  }
  async createPort() {
    this.writes.push("createPort");
    return { success: true as const, value: { fileCreated: "p.ts" } };
  }
  async createAdapter() {
    this.writes.push("createAdapter");
    return { success: true as const, value: { fileCreated: "a.ts" } };
  }
}

class EventBusFake implements EventBusPort {
  published: unknown[] = [];
  subscribe(): () => void {
    return () => {};
  }
  publish(event: unknown): void {
    this.published.push(event);
  }
  unsubscribe(): void {}
  clear(): void {}
}

function harness() {
  const write = new ManifestWriteSpy();
  const scaffolding = new ScaffoldingSpy();
  const events = new EventBusFake();
  const tm = new InMemoryTransactionManager();
  const accept = new AcceptTransactionToolUseCase(
    tm,
    write,
    scaffolding,
    events,
  );
  const reject = new RejectTransactionToolUseCase(tm);
  return { write, scaffolding, events, tm, accept, reject };
}

describe("MCP mutation tools require transaction approval", () => {
  it("create-context does not write until accept", async () => {
    const h = harness();
    const proposed = await new CreateContextToolUseCase(h.tm).execute({
      name: "local-llm",
      type: "core",
    });
    assert.equal(h.write.writes.length, 0);
    assert.equal(proposed.pendingApproval, true);
    const accepted = await h.accept.execute({
      transaction_id: proposed.transactionId ?? "",
    });
    assert.equal(accepted.success, true);
    assert.deepEqual(h.write.writes, ["registerBoundedContext"]);
    assert.equal(h.events.published.length, 1);
  });

  it("rejecting create-context never writes the manifest", async () => {
    const h = harness();
    const proposed = await new CreateContextToolUseCase(h.tm).execute({
      name: "local-llm",
      type: "core",
    });
    const rejected = await h.reject.execute({
      transaction_id: proposed.transactionId ?? "",
    });
    assert.equal(rejected.success, true);
    assert.equal(h.write.writes.length, 0);
  });

  it("add-dependency validates but does not write until accept", async () => {
    const h = harness();
    const proposed = await new AddDependencyToolUseCase(h.write, h.tm).execute({
      sourceModule: "billing",
      targetModule: "shared",
    });
    assert.ok(!h.write.writes.includes("addDependency"));
    const accepted = await h.accept.execute({
      transaction_id: proposed.transactionId ?? "",
    });
    assert.equal(accepted.success, true);
    assert.ok(h.write.writes.includes("addDependency"));
  });

  it("create-port does not scaffold or register until accept", async () => {
    const h = harness();
    const proposed = await new CreatePortToolUseCase(h.tm).execute({
      domain_name: "billing",
      port_name: "PayPort",
      type: "outbound",
    });
    assert.equal(h.scaffolding.writes.length, 0);
    assert.equal(h.write.writes.length, 0);
    const accepted = await h.accept.execute({
      transaction_id: proposed.transactionId ?? "",
    });
    assert.equal(accepted.success, true);
    assert.deepEqual(h.scaffolding.writes, ["createPort"]);
    assert.deepEqual(h.write.writes, ["registerPort"]);
  });

  it("create-adapter does not write until accept", async () => {
    const h = harness();
    const proposed = await new CreateAdapterToolUseCase(h.tm).execute({
      port_name: "PayPort",
      infrastructure_name: "stripe",
    });
    assert.equal(h.write.writes.length, 0);
    const accepted = await h.accept.execute({
      transaction_id: proposed.transactionId ?? "",
    });
    assert.equal(accepted.success, true);
    assert.deepEqual(h.write.writes, ["registerAdapter"]);
  });

  it("remove-port does not write until accept", async () => {
    const h = harness();
    const proposed = await new RemovePortToolUseCase(h.tm).execute({
      context_name: "billing",
      port_name: "PayPort",
      direction: "outbound",
    });
    assert.equal(h.write.writes.length, 0);
    const accepted = await h.accept.execute({
      transaction_id: proposed.transactionId ?? "",
    });
    assert.equal(accepted.success, true);
    assert.deepEqual(h.write.writes, ["removePort"]);
  });

  it("remove-context does not write until accept", async () => {
    const h = harness();
    const proposed = await new RemoveContextToolUseCase(h.tm).execute({
      context_name: "billing",
    });
    assert.equal(h.write.writes.length, 0);
    const accepted = await h.accept.execute({
      transaction_id: proposed.transactionId ?? "",
    });
    assert.equal(accepted.success, true);
    assert.deepEqual(h.write.writes, ["removeContext"]);
  });

  it("scaffold-module does not write until accept", async () => {
    const h = harness();
    const proposed = await new ScaffoldModuleToolUseCase(h.tm).execute({
      name: "billing",
      layer: "domain",
    });
    assert.equal(h.write.writes.length, 0);
    assert.equal(h.scaffolding.writes.length, 0);
    const accepted = await h.accept.execute({
      transaction_id: proposed.transactionId ?? "",
    });
    assert.equal(accepted.success, true);
    assert.deepEqual(h.scaffolding.writes, ["scaffoldModule"]);
    assert.deepEqual(h.write.writes, ["registerBoundedContext"]);
  });
});
