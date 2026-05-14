import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { LinterConfig } from "../src/index.js";
import { isSubpathViolation } from "../src/subpath-violation.js";

const SCOPE = "@hexagen";

const FULL_CONFIG: LinterConfig = {
  subpath_conventions: {
    server: {
      allowed_consumers: [
        "sync",
        "mcp-server",
        "tui",
        "api-gateway",
        "project-generation",
        "arch-linter",
      ],
      enforcement: "error",
    },
    client: {
      allowed_consumers: ["agentic-interaction", "manifest-generation"],
      enforcement: "warn",
    },
  },
};

describe("isSubpathViolation", () => {
  it("returns null for allowed server consumer", () => {
    const result = isSubpathViolation(
      "sync",
      "@hexagen/project-configuration/server",
      SCOPE,
      FULL_CONFIG,
    );
    assert.strictEqual(result, null);
  });

  it("returns violation for disallowed server consumer", () => {
    const result = isSubpathViolation(
      "manifest-generation",
      "@hexagen/project-configuration/server",
      SCOPE,
      FULL_CONFIG,
    );
    assert.deepStrictEqual(result, {
      violation: true,
      enforcement: "error",
      subpathType: "server",
    });
  });

  it("returns null for allowed client consumer (agentic-interaction)", () => {
    const result = isSubpathViolation(
      "agentic-interaction",
      "@hexagen/local-llm/client",
      SCOPE,
      FULL_CONFIG,
    );
    assert.strictEqual(result, null);
  });

  it("returns null for allowed client consumer (manifest-generation)", () => {
    const result = isSubpathViolation(
      "manifest-generation",
      "@hexagen/local-llm/client",
      SCOPE,
      FULL_CONFIG,
    );
    assert.strictEqual(result, null);
  });

  it("returns warn violation for client subpath import", () => {
    const result = isSubpathViolation(
      "sync",
      "@hexagen/project-configuration/client",
      SCOPE,
      FULL_CONFIG,
    );
    assert.deepStrictEqual(result, {
      violation: true,
      enforcement: "warn",
      subpathType: "client",
    });
  });

  it("returns null when subpath_conventions is absent from config", () => {
    const emptyConfig: LinterConfig = {};
    const result = isSubpathViolation(
      "sync",
      "@hexagen/project-configuration/server",
      SCOPE,
      emptyConfig,
    );
    assert.strictEqual(result, null);
  });

  it("returns null for non-subpath barrel import", () => {
    const result = isSubpathViolation(
      "sync",
      "@hexagen/project-configuration",
      SCOPE,
      FULL_CONFIG,
    );
    assert.strictEqual(result, null);
  });

  it("returns null for arch-linter as allowed server consumer", () => {
    const result = isSubpathViolation(
      "arch-linter",
      "@hexagen/project-configuration/server",
      SCOPE,
      FULL_CONFIG,
    );
    assert.strictEqual(result, null);
  });

  it("subpath violation short-circuits — enforcement error routes to errors", () => {
    const result = isSubpathViolation(
      "manifest-generation",
      "@hexagen/project-configuration/server",
      SCOPE,
      FULL_CONFIG,
    );
    assert.ok(result !== null);
    assert.strictEqual(result.enforcement, "error");
  });

  it("subpath violation — enforcement warn routes to warnings", () => {
    const result = isSubpathViolation(
      "sync",
      "@hexagen/local-llm/client",
      SCOPE,
      FULL_CONFIG,
    );
    assert.ok(result !== null);
    assert.strictEqual(result.enforcement, "warn");
  });
});
