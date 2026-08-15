import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { resolveLintScope } from "../src/resolve-scope.js";

// The linter's scope resolution MUST agree with @hexagen/sync's resolveScope,
// or it validates imports against the wrong namespace.
describe("resolveLintScope (parity with @hexagen/sync resolveScope)", () => {
  it("uses scope when present", () => {
    assert.equal(resolveLintScope({ scope: "acme", system: "sys" }), "acme");
  });

  it("falls back to system when scope is absent", () => {
    assert.equal(resolveLintScope({ system: "my-app" }), "my-app");
  });

  it("falls back to generated-project when neither is set", () => {
    assert.equal(resolveLintScope({}), "generated-project");
  });

  it("strips a leading @ (no double-@)", () => {
    assert.equal(resolveLintScope({ scope: "@my-scope" }), "my-scope");
  });

  it("sanitizes illegal characters and lowercases", () => {
    assert.equal(resolveLintScope({ scope: "My Org!!" }), "my-org");
  });

  it("matches the monorepo's own manifest (scope: hexagen)", () => {
    assert.equal(
      resolveLintScope({ scope: "hexagen", system: "hexagen-monaco" }),
      "hexagen",
    );
  });
});
