/**
 * Proves the real enforcement path trusts a grant shaped exactly like
 * `hexagen grant issue` (packages/sync/src/commands/grant/issue.ts) would
 * produce, and denies it the moment one field is changed after signing.
 *
 * This deliberately does not import @hexagen/sync — mcp-server's tests
 * only ever exercise its own src (see grant-enforcement.test.ts) and sync
 * is a devDependency of the build pipeline, not a runtime one here. Instead
 * this test signs a grant the same way the issuer does: HMAC-SHA256 over
 * `canonicalGrantPayload`, keyed by a real `.hexagen/grant-signing.key` on
 * disk, verified by the real `GrantSignatureAdapter` — the actual adapter
 * `hexagen_accept_transaction` uses, not a spy. `canonical.test.ts` in
 * packages/sync pins that package's copy of `canonicalGrantPayload` against
 * the same fixed output this file's algorithm produces, so the two can't
 * silently drift apart.
 */
import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { EventBusPort } from "@hexagen/messaging";
import type { Result } from "@hexagen/shared";
import { InMemoryTransactionManager } from "@hexagen/transaction-system";
import { AcceptTransactionToolUseCase } from "../../src/application/use-cases/accept-transaction-tool.use-case.js";
import { CreateContextToolUseCase } from "../../src/application/use-cases/create-context-tool.use-case.js";
import {
  MANIFEST_WRITE_PATH,
  canonicalGrantPayload,
  type Grant,
} from "../../src/application/kernel/grant.js";
import type { TraceRecord } from "../../src/application/kernel/trace.js";
import type { ManifestWritePort } from "../../src/application/ports/out/manifest-write.port.js";
import type { ScaffoldingPort } from "../../src/application/ports/out/scaffolding.port.js";
import type {
  TraceAppendInput,
  TraceWritePort,
} from "../../src/application/ports/out/trace-write.port.js";
import { GrantSignatureAdapter } from "../../src/infrastructure/adapters/grant-signature.adapter.js";

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

const NOW = new Date("2026-10-01T12:00:00.000Z");

const tempDirs: string[] = [];

/** Signs exactly the way `hexagen grant issue` does: HMAC-SHA256 over canonicalGrantPayload, keyed by the real on-disk trust root. */
async function issueSignedGrant(
  workspaceRoot: string,
  overrides: Partial<Grant> = {},
): Promise<Grant> {
  const keyHex = randomBytes(32).toString("hex");
  await mkdir(path.join(workspaceRoot, ".hexagen"), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, ".hexagen", "grant-signing.key"),
    keyHex,
  );

  const unsigned: Grant = {
    id: "grant-001",
    principal: "martin",
    agent: "lane-ow3b",
    contexts: ["billing"],
    paths: [MANIFEST_WRITE_PATH],
    tools: ["hexagen_create_context"],
    mode: "write",
    expires_at: "2026-10-01T16:00:00.000Z",
    ...overrides,
  };
  const signature = createHmac("sha256", Buffer.from(keyHex, "hex"))
    .update(canonicalGrantPayload(unsigned))
    .digest("hex");
  return { ...unsigned, signature };
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function harness(workspaceRoot: string) {
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
    new GrantSignatureAdapter(workspaceRoot),
    () => NOW,
  );
  const proposed = await new CreateContextToolUseCase(tm).execute({
    name: "billing",
    type: "core",
  });
  return { write, trace, accept, transactionId: proposed.transactionId ?? "" };
}

describe("A hexagen-grant-issue-shaped grant, checked by the real GrantSignatureAdapter", () => {
  it("is accepted: real on-disk key, real HMAC, real adapter — not a spy", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "grant-issuer-"));
    tempDirs.push(workspaceRoot);
    const grant = await issueSignedGrant(workspaceRoot);
    const h = await harness(workspaceRoot);

    const result = await h.accept.execute({
      transaction_id: h.transactionId,
      grant,
    });

    assert.equal(result.success, true);
    assert.deepEqual(h.write.writes, ["registerBoundedContext"]);
    assert.equal(h.trace.lines[0]?.halt_reason, "completed");
  });

  it("denies the same grant with one field flipped after signing — the signature no longer matches", async () => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "grant-issuer-"));
    tempDirs.push(workspaceRoot);
    const grant = await issueSignedGrant(workspaceRoot);
    const tampered: Grant = { ...grant, contexts: ["not-billing"] };
    const h = await harness(workspaceRoot);

    const result = await h.accept.execute({
      transaction_id: h.transactionId,
      grant: tampered,
    });

    assert.equal(result.success, false);
    assert.match(String(result.error), /no valid signature/);
    assert.equal(h.write.writes.length, 0);
    assert.equal(h.trace.lines[0]?.halt_reason, "grant_denied");
  });

  it("denies a grant when checked against a different workspace root (no matching trust root there)", async () => {
    const workspaceRootA = await mkdtemp(
      path.join(tmpdir(), "grant-issuer-a-"),
    );
    const workspaceRootB = await mkdtemp(
      path.join(tmpdir(), "grant-issuer-b-"),
    );
    tempDirs.push(workspaceRootA, workspaceRootB);
    const grant = await issueSignedGrant(workspaceRootA);
    const h = await harness(workspaceRootB);

    const result = await h.accept.execute({
      transaction_id: h.transactionId,
      grant,
    });

    assert.equal(result.success, false);
    assert.match(String(result.error), /no valid signature/);
  });
});
