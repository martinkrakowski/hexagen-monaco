import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { LinterConfig } from "../src/index.js";

const SCOPE = "@hexagen";

function isSubpathViolation(
  fromPackage: string,
  moduleSpecifier: string,
  scope: string,
  config: LinterConfig,
): {
  violation: true;
  enforcement: "error" | "warn";
  subpathType: "server" | "client";
} | null {
  const conventions = config.subpath_conventions;
  if (!conventions) return null;

  if (moduleSpecifier === `${scope}/local-llm/shared`) return null;

  const subpathMatch = moduleSpecifier.match(
    new RegExp(`^${scope}/([\\w-]+)/(server|client)$`),
  );
  if (!subpathMatch) return null;

  const [, , subpathType] = subpathMatch;
  const convention = conventions[subpathType as "server" | "client"];
  if (!convention) return null;

  const allowedConsumers = convention.allowed_consumers ?? [];
  if (allowedConsumers.includes(fromPackage)) return null;

  return {
    violation: true,
    enforcement: convention.enforcement,
    subpathType: subpathType as "server" | "client",
  };
}

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
      allowed_consumers: [],
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

  it("returns null for legacy local-llm/shared bypass (DEBT-001)", () => {
    const result = isSubpathViolation(
      "agentic-interaction",
      "@hexagen/local-llm/shared",
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
