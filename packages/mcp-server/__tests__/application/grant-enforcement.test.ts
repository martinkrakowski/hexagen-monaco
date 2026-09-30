/**
 * Grant enforcement at the hexagen_accept_transaction choke point
 * (docs/kernel/GRANT.md "Enforcement point"). Unlike
 * manifest-mutation-approval.test.ts (which exercises the seven mutation
 * tools end to end with an always-valid grant), these tests hold the
 * mutation fixed and vary only the grant, to isolate each deny path:
 * in-scope accept, out-of-scope deny, missing grant, expired, revoked, and
 * propose-mode denial. No test here goes through the network — everything
 * is in-memory fakes.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { EventBusPort } from "@hexagen/messaging";
import type { Result } from "@hexagen/shared";
import { InMemoryTransactionManager } from "@hexagen/transaction-system";
import { AcceptTransactionToolUseCase } from "../../src/application/use-cases/accept-transaction-tool.use-case.js";
import { CreateContextToolUseCase } from "../../src/application/use-cases/create-context-tool.use-case.js";
import {
  MANIFEST_WRITE_PATH,
  type Grant,
} from "../../src/application/kernel/grant.js";
import type { TraceRecord } from "../../src/application/kernel/trace.js";
import type { ManifestWritePort } from "../../src/application/ports/out/manifest-write.port.js";
import type { ScaffoldingPort } from "../../src/application/ports/out/scaffolding.port.js";
import type {
  TraceAppendInput,
  TraceWritePort,
} from "../../src/application/ports/out/trace-write.port.js";
import type { GrantSignaturePort } from "../../src/application/ports/out/grant-signature.port.js";

class ManifestWriteSpy implements ManifestWritePort {
  writes: string[] = [];
  async validateDependency() {
    return { success: true as const, value: { valid: true, errors: [] } };
  }
  async addDependency() {
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
    return { success: true as const, value: { registered: true } };
  }
  async registerAdapter() {
    return { success: true as const, value: { registered: true } };
  }
  async removePort() {
    return { success: true as const, value: { removed: true } };
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

class TraceWriteSpy implements TraceWritePort {
  lines: TraceRecord[] = [];
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

class FailingTraceWriteSpy implements TraceWritePort {
  calls = 0;
  async appendLine(): Promise<Result<void, Error>> {
    this.calls += 1;
    return { success: false, error: new Error("disk full") };
  }
}

/** Configurable stand-in for the trusted-issuer check; defaults to "signed by a trusted issuer". */
class GrantSignatureSpy implements GrantSignaturePort {
  calls = 0;
  result: Result<boolean, Error> = { success: true, value: true };
  async verify(): Promise<Result<boolean, Error>> {
    this.calls += 1;
    return this.result;
  }
}

const NOW = new Date("2026-09-30T12:00:00.000Z");

function baseGrant(overrides: Partial<Grant> = {}): Grant {
  return {
    id: "grant-001",
    principal: "martin",
    agent: "agent-1",
    contexts: ["billing"],
    paths: [MANIFEST_WRITE_PATH],
    tools: ["hexagen_create_context"],
    mode: "write",
    expires_at: "2026-09-30T18:00:00.000Z",
    signature: "test-signature",
    ...overrides,
  };
}

async function harnessWithPendingCreateContext(
  grantSignaturePort: GrantSignaturePort = new GrantSignatureSpy(),
) {
  const write = new ManifestWriteSpy();
  const scaffolding = new ScaffoldingStub();
  const events = new EventBusFake();
  const trace = new TraceWriteSpy();
  const tm = new InMemoryTransactionManager();
  const accept = new AcceptTransactionToolUseCase(
    tm,
    write,
    scaffolding,
    events,
    trace,
    grantSignaturePort,
    () => NOW,
  );
  const proposed = await new CreateContextToolUseCase(tm).execute({
    name: "billing",
    type: "core",
  });
  return { write, trace, accept, transactionId: proposed.transactionId ?? "" };
}

describe("Grant enforcement at hexagen_accept_transaction", () => {
  it("allows an in-scope accept: tool, context, and .architecture/ path all granted", async () => {
    const h = await harnessWithPendingCreateContext();
    const result = await h.accept.execute({
      transaction_id: h.transactionId,
      grant: baseGrant(),
    });
    assert.equal(result.success, true);
    assert.deepEqual(h.write.writes, ["registerBoundedContext"]);
    assert.equal(h.trace.lines[0]?.halt_reason, "completed");
  });

  it("denies an out-of-scope mutation: context not in grant.contexts, never claims", async () => {
    const h = await harnessWithPendingCreateContext();
    const result = await h.accept.execute({
      transaction_id: h.transactionId,
      grant: baseGrant({ contexts: ["local-llm"] }),
    });
    assert.equal(result.success, false);
    assert.match(String(result.error), /does not include context 'billing'/);
    assert.equal(h.write.writes.length, 0);
    assert.equal(h.trace.lines[0]?.halt_reason, "grant_denied");
  });

  it("denies when the mutation's tool is not in grant.tools", async () => {
    const h = await harnessWithPendingCreateContext();
    const result = await h.accept.execute({
      transaction_id: h.transactionId,
      grant: baseGrant({ tools: ["hexagen_scaffold_module"] }),
    });
    assert.equal(result.success, false);
    assert.match(
      String(result.error),
      /does not include tool 'hexagen_create_context'/,
    );
    assert.equal(h.write.writes.length, 0);
  });

  it("denies when the grant does not cover the manifest write path", async () => {
    const h = await harnessWithPendingCreateContext();
    const result = await h.accept.execute({
      transaction_id: h.transactionId,
      grant: baseGrant({ paths: ["packages/billing/"] }),
    });
    assert.equal(result.success, false);
    assert.match(
      String(result.error),
      /does not include path '\.architecture\/'/,
    );
    assert.equal(h.write.writes.length, 0);
  });

  it("denies with no grant supplied at all, and never claims the transaction", async () => {
    const h = await harnessWithPendingCreateContext();
    const result = await h.accept.execute({ transaction_id: h.transactionId });
    assert.equal(result.success, false);
    assert.match(String(result.error), /No Grant supplied/);
    assert.equal(h.write.writes.length, 0);
    // No grant id to reference — no trace line is written (Trace without a
    // Grant id is not evidence, per docs/kernel/TRACE.md).
    assert.equal(h.trace.lines.length, 0);
  });

  it("denies a call at or after the grant's revoked_at, even before expires_at", async () => {
    const h = await harnessWithPendingCreateContext();
    const result = await h.accept.execute({
      transaction_id: h.transactionId,
      grant: baseGrant({ revoked_at: "2026-09-30T12:00:00.000Z" }),
    });
    assert.equal(result.success, false);
    assert.match(String(result.error), /revoked at/);
    assert.equal(h.write.writes.length, 0);
    assert.equal(h.trace.lines[0]?.halt_reason, "grant_revoked");
  });

  it("allows a call exactly at revoked_at minus nothing — strictly before revocation still works", async () => {
    const h = await harnessWithPendingCreateContext();
    const result = await h.accept.execute({
      transaction_id: h.transactionId,
      grant: baseGrant({ revoked_at: "2026-09-30T12:00:00.001Z" }),
    });
    assert.equal(result.success, true);
  });

  it("denies a call strictly after expires_at", async () => {
    const h = await harnessWithPendingCreateContext();
    const result = await h.accept.execute({
      transaction_id: h.transactionId,
      grant: baseGrant({ expires_at: "2026-09-30T11:59:59.999Z" }),
    });
    assert.equal(result.success, false);
    assert.match(String(result.error), /expired at/);
    assert.equal(h.write.writes.length, 0);
    assert.equal(h.trace.lines[0]?.halt_reason, "grant_expired");
  });

  it("allows a call exactly at expires_at — the boundary is in-window", async () => {
    const h = await harnessWithPendingCreateContext();
    const result = await h.accept.execute({
      transaction_id: h.transactionId,
      grant: baseGrant({ expires_at: "2026-09-30T12:00:00.000Z" }),
    });
    assert.equal(result.success, true);
  });

  it("denies a 'propose' mode grant: it may create a Transaction but never accept it", async () => {
    const h = await harnessWithPendingCreateContext();
    const result = await h.accept.execute({
      transaction_id: h.transactionId,
      grant: baseGrant({ mode: "propose" }),
    });
    assert.equal(result.success, false);
    assert.match(String(result.error), /mode 'propose'/);
    assert.equal(h.write.writes.length, 0);
    assert.equal(h.trace.lines[0]?.halt_reason, "grant_denied");
  });

  it("surfaces trace_write_error when the Trace write fails, without hiding a successful accept", async () => {
    const write = new ManifestWriteSpy();
    const scaffolding = new ScaffoldingStub();
    const events = new EventBusFake();
    const trace = new FailingTraceWriteSpy();
    const tm = new InMemoryTransactionManager();
    const accept = new AcceptTransactionToolUseCase(
      tm,
      write,
      scaffolding,
      events,
      trace,
      new GrantSignatureSpy(),
      () => NOW,
    );
    const proposed = await new CreateContextToolUseCase(tm).execute({
      name: "billing",
      type: "core",
    });
    const result = await accept.execute({
      transaction_id: proposed.transactionId ?? "",
      grant: baseGrant(),
    });
    assert.equal(result.success, true);
    assert.deepEqual(write.writes, ["registerBoundedContext"]);
    if (result.success) {
      assert.match(String(result.value.trace_write_error), /disk full/);
    }
    assert.equal(trace.calls, 1);
  });

  it("folds a Trace write failure into the deny reason when the grant is also denied", async () => {
    const write = new ManifestWriteSpy();
    const scaffolding = new ScaffoldingStub();
    const events = new EventBusFake();
    const trace = new FailingTraceWriteSpy();
    const tm = new InMemoryTransactionManager();
    const accept = new AcceptTransactionToolUseCase(
      tm,
      write,
      scaffolding,
      events,
      trace,
      new GrantSignatureSpy(),
      () => NOW,
    );
    const proposed = await new CreateContextToolUseCase(tm).execute({
      name: "billing",
      type: "core",
    });
    const result = await accept.execute({
      transaction_id: proposed.transactionId ?? "",
      grant: baseGrant({ contexts: ["local-llm"] }),
    });
    assert.equal(result.success, false);
    assert.match(String(result.error), /does not include context 'billing'/);
    assert.match(
      String(result.error),
      /trace evidence write failed: disk full/,
    );
    assert.equal(write.writes.length, 0);
    assert.equal(trace.calls, 1);
  });

  it("denies a grant with no signature, and never claims the transaction", async () => {
    const signaturePort = new GrantSignatureSpy();
    signaturePort.result = { success: true, value: false };
    const h = await harnessWithPendingCreateContext(signaturePort);
    const result = await h.accept.execute({
      transaction_id: h.transactionId,
      grant: baseGrant({ signature: undefined }),
    });
    assert.equal(result.success, false);
    assert.match(String(result.error), /no valid signature/);
    assert.equal(h.write.writes.length, 0);
    assert.equal(signaturePort.calls, 1);
    assert.equal(h.trace.lines[0]?.halt_reason, "grant_denied");
  });

  it("denies a grant whose signature does not verify, before any scope check runs", async () => {
    const signaturePort = new GrantSignatureSpy();
    signaturePort.result = { success: true, value: false };
    const h = await harnessWithPendingCreateContext(signaturePort);
    // Scope is otherwise fully out of bounds too, to prove signature is
    // checked first: the error names the signature, not the scope.
    const result = await h.accept.execute({
      transaction_id: h.transactionId,
      grant: baseGrant({ signature: "wrong", contexts: ["nowhere"] }),
    });
    assert.equal(result.success, false);
    assert.match(String(result.error), /no valid signature/);
    assert.equal(h.write.writes.length, 0);
  });

  it("denies and reports when the signature port itself fails (e.g. the trust root is unreadable)", async () => {
    const signaturePort = new GrantSignatureSpy();
    signaturePort.result = {
      success: false,
      error: new Error("EACCES reading .hexagen/grant-signing.key"),
    };
    const h = await harnessWithPendingCreateContext(signaturePort);
    const result = await h.accept.execute({
      transaction_id: h.transactionId,
      grant: baseGrant(),
    });
    assert.equal(result.success, false);
    assert.match(String(result.error), /could not be verified/);
    assert.match(String(result.error), /EACCES/);
    assert.equal(h.write.writes.length, 0);
  });
});
