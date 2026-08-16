import { describe, it, vi, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

// Mock the composition root and logger; the route logic (path anchoring,
// lint → restore → rollback flow) runs for real.
vi.mock("@/lib/wire.server", async () => {
  // Re-export the REAL MonorepoRootNotFoundError (not a stand-in) so the 500-vs-400
  // tests exercise the genuine production error type — its real prototype and
  // .name. Route and test both import it from this one mocked module, so identity
  // already lines up; using the real class keeps the assertion faithful to prod
  // rather than merely internally consistent with a look-alike.
  const { MonorepoRootNotFoundError } = await vi.importActual<
    typeof import("@/lib/monorepo-root")
  >("@/lib/monorepo-root");
  return {
    getTransactionManager: vi.fn(),
    getManifestMutation: vi.fn(),
    getLintValidation: vi.fn(),
    findMonorepoRoot: vi.fn(),
    MonorepoRootNotFoundError,
  };
});
// The full LoggerPort surface, not just the two methods the route happened to
// call before. A partial logger mock turns any future `logger.warn`/`.error`
// into a TypeError that the route's outer catch converts to a 500 — which can
// make a test asserting "500 / success:false" pass for entirely the wrong
// reason.
vi.mock("@/lib/wire.shared", () => ({
  createWebLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    errorWithException: vi.fn(),
  }),
}));

import { POST } from "../route";
import {
  getTransactionManager,
  getManifestMutation,
  getLintValidation,
  findMonorepoRoot,
  MonorepoRootNotFoundError,
} from "@/lib/wire.server";

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/architecture/modify/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/architecture/modify/accept", () => {
  const rollback = vi.fn();
  const commit = vi.fn();
  const applyPatches = vi.fn();
  const restoreFromGit = vi.fn();

  beforeEach(() => {
    rollback.mockReset();
    commit.mockReset();
    applyPatches.mockReset();
    restoreFromGit.mockReset();

    vi.mocked(findMonorepoRoot).mockReturnValue("/fake/repo");
    // Simulate prod cwd ≠ monorepo root.
    vi.spyOn(process, "cwd").mockReturnValue("/fake/repo/apps/web");

    // `commit()` returns the COMMITTED transaction, as the port requires —
    // returning nothing means "not committed" (already terminal), which the
    // saga now treats as a conflict rather than a success.
    commit.mockReturnValue({ id: "tx-1", status: "committed", metadata: {} });
    vi.mocked(getTransactionManager).mockReturnValue({
      get: () => ({ status: "speculative", metadata: { patches: [] } }),
      rollback,
      commit,
    } as never);

    applyPatches.mockResolvedValue({ success: true, value: undefined });
    vi.mocked(getManifestMutation).mockReturnValue({
      applyPatches,
      restoreFromGit,
    } as never);

    // Lint FAILS → drives the restore branch.
    vi.mocked(getLintValidation).mockReturnValue({
      validateManifest: vi.fn().mockResolvedValue({
        success: true,
        value: { valid: false, errors: ["boom"] },
      }),
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores the manifest against the monorepo-root anchor, not process.cwd()", async () => {
    restoreFromGit.mockResolvedValue({ success: true, value: undefined });

    await POST(post({ transactionId: "tx-1" }));

    assert.equal(restoreFromGit.mock.calls.length, 1);
    assert.equal(
      restoreFromGit.mock.calls[0][0],
      "/fake/repo/.architecture/manifest.yaml",
    );
  });

  it("rolls the transaction back even when git restore fails (never stuck speculative)", async () => {
    restoreFromGit.mockResolvedValue({
      success: false,
      error: new Error("git checkout failed"),
    });

    const res = await POST(post({ transactionId: "tx-1" }));

    assert.equal(rollback.mock.calls.length, 1);
    assert.equal(rollback.mock.calls[0][0], "tx-1");
    assert.equal(res.status, 500);
  });

  it("returns 500 (not 400) when the monorepo-root/manifest anchor is missing", async () => {
    // A missing on-disk anchor is a server packaging/config failure; mapping it
    // to 400 would hide it from 5xx monitoring and blame the caller.
    vi.mocked(findMonorepoRoot).mockImplementation(() => {
      throw new MonorepoRootNotFoundError(
        "Could not locate monorepo root from /x. No .architecture/manifest.yaml found.",
      );
    });

    const res = await POST(post({ transactionId: "tx-1" }));

    assert.equal(res.status, 500);
    // The rethrow lands in the outer catch, which is ALSO a 500 catch-all — so a
    // bare status check can't tell the intended MonorepoRootNotFoundError rethrow
    // from an incidental failure that happens to reach the same handler. Pin the
    // branch AND the wire contract: the outer catch must map the anchor error to
    // the stable client-safe message — NOT err.message, whose text embeds the
    // server's `from`/process.cwd() filesystem path. Returning that raw message
    // (the pre-fix behavior) would disclose the server layout to the client
    // (CWE-209 — independent of CORS). No mutation work may have run (we short-
    // circuited at path validation, before applyPatches).
    const body = await res.json();
    assert.equal(body.error, "Monorepo root not found");
    assert.doesNotMatch(body.error, /Could not locate|manifest\.yaml|\/x/);
    assert.equal(applyPatches.mock.calls.length, 0);
    assert.equal(restoreFromGit.mock.calls.length, 0);
    assert.equal(commit.mock.calls.length, 0);
  });

  it("still returns 400 for a path-traversal manifestPath (client input error)", async () => {
    const res = await POST(
      post({ transactionId: "tx-1", manifestPath: "../../etc/passwd" }),
    );

    assert.equal(res.status, 400);
  });
});

/**
 * AUD-004 — the accept saga's untested arms.
 *
 * The Wave-1 tests above pin the anchor and the LINT-failure arm of the
 * compensation. These pin the arms Wave-1 never reached: the unchecked
 * `tx.metadata.patches as Patch[]` read, the apply-failure arm (which had no
 * compensation at all), and a lint invocation that fails as infrastructure
 * rather than reporting a violation.
 */
describe("POST /api/architecture/modify/accept — saga arms (AUD-004)", () => {
  const rollback = vi.fn();
  const commit = vi.fn();
  const applyPatches = vi.fn();
  const restoreFromGit = vi.fn();
  const validateManifest = vi.fn();

  /** Install a transaction whose `metadata` is exactly what the test supplies. */
  function withMetadata(metadata: Record<string, unknown>): void {
    vi.mocked(getTransactionManager).mockReturnValue({
      get: () => ({ id: "tx-1", status: "speculative", metadata }),
      rollback,
      commit,
    } as never);
  }

  /**
   * As `withMetadata`, but `get()` returns `speculative` only on the FIRST
   * call — the saga's re-read after a refused commit sees `laterStatus`. That
   * is the shape of a concurrent finalisation.
   */
  function withConcurrentFinalisation(
    metadata: Record<string, unknown>,
    laterStatus: string,
  ): void {
    let first = true;
    vi.mocked(getTransactionManager).mockReturnValue({
      get: () => {
        const status = first ? "speculative" : laterStatus;
        first = false;
        return { id: "tx-1", status, metadata };
      },
      rollback,
      commit,
    } as never);
  }

  beforeEach(() => {
    rollback.mockReset();
    commit.mockReset();
    applyPatches.mockReset();
    restoreFromGit.mockReset();
    validateManifest.mockReset();

    vi.mocked(findMonorepoRoot).mockReturnValue("/fake/repo");

    applyPatches.mockResolvedValue({ success: true, value: undefined });
    restoreFromGit.mockResolvedValue({ success: true, value: undefined });
    vi.mocked(getManifestMutation).mockReturnValue({
      applyPatches,
      restoreFromGit,
    } as never);

    // Lint PASSES by default here — these tests drive the arms *before* lint,
    // and one overrides it to fail as infrastructure.
    validateManifest.mockResolvedValue({
      success: true,
      value: { valid: true, errors: [] },
    });
    vi.mocked(getLintValidation).mockReturnValue({
      validateManifest,
    } as never);

    commit.mockReturnValue({ id: "tx-1", status: "committed", metadata: {} });
    withMetadata({ patches: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not report success when the transaction carries no patch metadata", async () => {
    // The producer (ModifyArchitectureUseCase) always writes `patches`. A
    // transaction reaching accept WITHOUT it is a broken producer or a
    // transaction from another pipeline — either way the saga must refuse,
    // not silently commit a zero-patch no-op as an accepted modification.
    withMetadata({ intentId: "i-1" });

    const res = await POST(post({ transactionId: "tx-1" }));
    const body = await res.json();

    assert.equal(body.success, false);
    assert.equal(commit.mock.calls.length, 0);
    assert.equal(applyPatches.mock.calls.length, 0);
  });

  it("does not feed a non-array `patches` value to the mutation adapter", async () => {
    // `as Patch[]` makes a string typecheck as a patch array. `"oops".length`
    // is 4, so the pre-fix route reported `patchesApplied: 4` for a payload
    // that is not a patch at all.
    withMetadata({ patches: "oops" });

    const res = await POST(post({ transactionId: "tx-1" }));
    const body = await res.json();

    assert.equal(body.success, false);
    // Measured pre-fix: `{ patchesApplied: 4, success: true }` — "oops".length.
    assert.notEqual(body.patchesApplied, 4);
    assert.equal(applyPatches.mock.calls.length, 0);
    assert.equal(commit.mock.calls.length, 0);
  });

  it("does not feed structurally invalid patch objects to the mutation adapter", async () => {
    // An array of the wrong element type passes `as Patch[]` just as easily.
    withMetadata({ patches: [{ nope: true }] });

    const res = await POST(post({ transactionId: "tx-1" }));
    const body = await res.json();

    assert.equal(body.success, false);
    assert.equal(applyPatches.mock.calls.length, 0);
    assert.equal(commit.mock.calls.length, 0);
  });

  it("accepts a well-formed patch array (the guard is not simply refusing everything)", async () => {
    withMetadata({
      patches: [
        { id: "p1", type: "add_node", targetId: "n1", payload: { a: 1 } },
      ],
    });

    const res = await POST(post({ transactionId: "tx-1" }));
    const body = await res.json();

    assert.equal(body.success, true);
    assert.equal(body.patchesApplied, 1);
    assert.equal(commit.mock.calls.length, 1);
    assert.equal(applyPatches.mock.calls.length, 1);
  });

  it("compensates when patch application fails (never leaves the transaction speculative)", async () => {
    // Wave-1 (#441) established "the transaction is never stuck speculative"
    // for the lint/restore arm. The apply-failure arm returned 500 without
    // rolling back OR restoring — a stuck transaction plus a possibly
    // half-applied manifest on disk.
    withMetadata({
      patches: [
        { id: "p1", type: "add_node", targetId: "n1", payload: { a: 1 } },
      ],
    });
    applyPatches.mockResolvedValue({
      success: false,
      error: new Error("bad patch"),
    });

    const res = await POST(post({ transactionId: "tx-1" }));

    assert.equal(res.status, 500);
    assert.equal(restoreFromGit.mock.calls.length, 1);
    assert.equal(
      restoreFromGit.mock.calls[0][0],
      "/fake/repo/.architecture/manifest.yaml",
    );
    assert.equal(rollback.mock.calls.length, 1);
    assert.equal(rollback.mock.calls[0][0], "tx-1");
    assert.equal(commit.mock.calls.length, 0);
  });

  it("reports a failed lint INVOCATION as an infrastructure failure, not a lint violation", async () => {
    // `validateManifest` returning `{success:false}` means the linter could not
    // run (shell-out crashed / timed out). The pre-fix route folded that into
    // the violation branch: HTTP 200, "Lint validation failed. Patches
    // reverted.", `lintErrors: []` — indistinguishable to the operator from a
    // genuine violation, and invisible to 5xx monitoring.
    withMetadata({
      patches: [
        { id: "p1", type: "add_node", targetId: "n1", payload: { a: 1 } },
      ],
    });
    validateManifest.mockResolvedValue({
      success: false,
      error: new Error("lint CLI crashed"),
    });

    const res = await POST(post({ transactionId: "tx-1" }));
    const body = await res.json();

    assert.equal(res.status, 500);
    assert.equal(body.success, false);
    assert.notEqual(body.error, "Lint validation failed. Patches reverted.");
    assert.match(body.error, /could not be run|unavailable/i);
    // The compensation still runs: patches were applied, so they must come back
    // out and the transaction must not stay speculative.
    assert.equal(restoreFromGit.mock.calls.length, 1);
    assert.equal(rollback.mock.calls.length, 1);
    assert.equal(commit.mock.calls.length, 0);
  });

  it("does not report a commit that the manager refused", async () => {
    // `commit()` returning null means "not committed" — the transaction is
    // already terminal because an overlapping reject finalised it during the
    // awaited applyPatches/lint. The pre-fix saga fell back to the `speculative`
    // transaction it had read at the top and answered HTTP 200
    // `status:"committed"` for a transaction that is actually rolled back.
    withConcurrentFinalisation(
      {
        patches: [
          { id: "p1", type: "add_node", targetId: "n1", payload: { a: 1 } },
        ],
      },
      "rolled_back",
    );
    commit.mockReturnValue(null);

    const res = await POST(post({ transactionId: "tx-1" }));
    const body = await res.json();

    assert.equal(body.success, false);
    assert.notEqual(body.status, "committed");
    assert.equal(res.status, 409);
    assert.match(body.error, /concurrently finalised/i);
    // Our patches landed on disk after the reject's restore, so they must come
    // back out — otherwise a rolled-back transaction leaves its patches behind.
    assert.equal(restoreFromGit.mock.calls.length, 1);
  });

  it("returns 404 for an unknown transaction", async () => {
    vi.mocked(getTransactionManager).mockReturnValue({
      get: () => null,
      rollback,
      commit,
    } as never);

    const res = await POST(post({ transactionId: "nope" }));

    assert.equal(res.status, 404);
    assert.equal(applyPatches.mock.calls.length, 0);
  });

  it("returns 409 when the transaction is not speculative", async () => {
    vi.mocked(getTransactionManager).mockReturnValue({
      get: () => ({ id: "tx-1", status: "committed", metadata: {} }),
      rollback,
      commit,
    } as never);

    const res = await POST(post({ transactionId: "tx-1" }));
    const body = await res.json();

    assert.equal(res.status, 409);
    assert.match(body.error, /committed/);
    assert.equal(applyPatches.mock.calls.length, 0);
  });
});
