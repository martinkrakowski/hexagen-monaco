import { describe, it } from "vitest";
import assert from "node:assert";
import {
  toPascalCase,
  toPascalCaseIdentifier,
} from "../../src/domain/services/name-normalizer.js";

// A3 — the ONE shared name normalizer. `normalizeStubName`,
// `architecture-files.ts` (ownership registry), and `cross-context.ts`
// (adapter class names) all render names through it. These tests pin the
// POLICY on exactly the inputs where the old private copies diverged.

describe("toPascalCase (shared policy)", () => {
  it("splits kebab", () => {
    assert.equal(toPascalCase("user-repo"), "UserRepo");
  });

  it("splits underscores (the old generator copies did NOT — divergence fixed)", () => {
    // Pre-A3 `architecture-files.ts`/`cross-context.ts` split on `[-.]` only,
    // rendering `user_repo` as `User_repo` while its stub identifier was
    // `UserRepo`. One normalizer, one answer.
    assert.equal(toPascalCase("user_repo"), "UserRepo");
  });

  it("splits dots", () => {
    assert.equal(
      toPascalCase("rest-controller.in-port.ts"),
      "RestControllerInPortTs",
    );
  });

  it("is a no-op for already-clean PascalCase", () => {
    assert.equal(toPascalCase("OrderRepository"), "OrderRepository");
  });

  it("makes no identifier promise (digit-leading / empty pass through)", () => {
    assert.equal(toPascalCase("3d-renderer"), "3dRenderer");
    assert.equal(toPascalCase("---"), "");
    assert.equal(toPascalCase(""), "");
  });
});

describe("toPascalCaseIdentifier (identifier-guarded form)", () => {
  it("prefixes digit-leading names (matches stub emission, #242)", () => {
    assert.equal(toPascalCaseIdentifier("3d-renderer"), "Stub3dRenderer");
  });

  it("falls back to 'Stub' when normalization empties the name", () => {
    assert.equal(toPascalCaseIdentifier("---"), "Stub");
    assert.equal(toPascalCaseIdentifier(""), "Stub");
  });

  it("matches toPascalCase for well-formed names", () => {
    assert.equal(toPascalCaseIdentifier("user_repo"), "UserRepo");
    assert.equal(toPascalCaseIdentifier("relational-db"), "RelationalDb");
    assert.equal(toPascalCaseIdentifier("OrderRepository"), "OrderRepository");
  });
});
