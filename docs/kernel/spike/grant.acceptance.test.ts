/**
 * Acceptance tests for the Grant kernel object spec (docs/kernel/GRANT.md).
 *
 * These exercise the standalone reference module `grant.ts` (same
 * directory, docs/kernel/spike/) —
 * not any wiring into `AcceptTransactionToolUseCase` — that wiring does
 * not exist yet (see the spec's "Enforcement point" section). What these
 * tests establish is the contract a future wiring slice must satisfy:
 * default deny, fail closed, and a rejection that never reaches a write
 * port.
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  compileGrant,
  checkMutationAgainstGrant,
  type GrantManifest,
  type MutationRef,
} from "./grant.js";

const manifest: GrantManifest = {
  bounded_contexts: [
    { name: "billing" },
    { name: "shared" },
    { name: "local-llm" },
  ],
};

describe("compileGrant", () => {
  it("expands granted contexts to packages/<context>/ path prefixes", () => {
    const grant = compileGrant(["billing"], manifest);
    assert.deepEqual(grant.contexts, ["billing"]);
    assert.deepEqual(grant.paths, ["packages/billing/"]);
  });

  it("appends caller-supplied extra paths without widening contexts", () => {
    const grant = compileGrant(["billing"], manifest, [
      "packages/shared/codegen/billing/",
    ]);
    assert.deepEqual(grant.paths, [
      "packages/billing/",
      "packages/shared/codegen/billing/",
    ]);
    assert.deepEqual(grant.contexts, ["billing"]);
  });

  it("fails closed on a context name absent from the manifest", () => {
    assert.throws(
      () => compileGrant(["not-a-real-context"], manifest),
      /unknown manifest context/i,
    );
  });

  it("compiling zero contexts yields a grant that denies everything", () => {
    const grant = compileGrant([], manifest);
    const mutation: MutationRef = { kind: "create-context", context: "billing" };
    const check = checkMutationAgainstGrant(grant, mutation);
    assert.equal(check.allowed, false);
  });
});

describe("checkMutationAgainstGrant — default deny, in-scope allowed", () => {
  it("allows a mutation whose context the grant names", () => {
    const grant = compileGrant(["billing"], manifest);
    const mutation: MutationRef = { kind: "scaffold-module", context: "billing" };
    const check = checkMutationAgainstGrant(grant, mutation);
    assert.equal(check.allowed, true);
  });

  it("rejects an out-of-scope mutation naming a context the grant never listed", () => {
    const grant = compileGrant(["billing"], manifest);
    // The agent cycle was granted `billing` only; this mutation would write
    // to `local-llm`, a context entirely outside the grant.
    const outOfScope: MutationRef = {
      kind: "create-adapter",
      context: "local-llm",
    };

    const check = checkMutationAgainstGrant(grant, outOfScope);

    assert.equal(check.allowed, false);
    if (!check.allowed) {
      assert.match(check.reason, /does not include context 'local-llm'/);
    }
  });

  it("rejects when the context is granted but a narrower path override excludes it", () => {
    // A grant may narrow `paths` below the full context prefix (e.g. a
    // reviewer scopes the cycle to one sub-directory). Naming the context
    // is not by itself sufficient if `paths` was overridden to exclude it.
    const grant = compileGrant(["shared"], manifest, []);
    const narrowed = { contexts: grant.contexts, paths: ["packages/shared/types/"] };
    const mutation: MutationRef = { kind: "create-port", context: "shared" };

    const check = checkMutationAgainstGrant(narrowed, mutation);

    assert.equal(check.allowed, false);
    if (!check.allowed) {
      assert.match(check.reason, /does not include path/);
    }
  });

  it("two independently granted contexts each stay scoped to their own paths", () => {
    const grant = compileGrant(["billing", "shared"], manifest);
    assert.equal(
      checkMutationAgainstGrant(grant, { kind: "create-context", context: "billing" })
        .allowed,
      true,
    );
    assert.equal(
      checkMutationAgainstGrant(grant, { kind: "create-context", context: "shared" })
        .allowed,
      true,
    );
    assert.equal(
      checkMutationAgainstGrant(grant, {
        kind: "create-context",
        context: "local-llm",
      }).allowed,
      false,
    );
  });
});
