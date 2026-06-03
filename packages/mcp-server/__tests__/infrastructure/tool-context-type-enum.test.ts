import { describe, it } from "node:test";
import assert from "node:assert";
import { BOUNDED_CONTEXT_TYPES } from "@hexagen/shared";
import { createContextTool } from "../../src/infrastructure/adapters/tools/create-context.js";
import { scaffoldModuleTool } from "../../src/infrastructure/adapters/tools/scaffold-module.js";

// Regression guard for the bounded-context-type single-sourcing (#201 / PR D).
// The original drift happened because these enums were hand-written and silently
// dropped values ("driver", and elsewhere "generic"). Assert each MCP tool's
// context-type enum is DERIVED from the canonical BOUNDED_CONTEXT_TYPES so a
// hand-edit can't quietly narrow it again.
function contextTypeEnum(
  tool: { inputSchema: Record<string, unknown> },
  prop: string,
): unknown {
  const properties = (
    tool.inputSchema as { properties?: Record<string, unknown> }
  ).properties;
  const field = properties?.[prop] as { enum?: unknown } | undefined;
  return field?.enum;
}

describe("MCP tool context-type enums derive from the canonical set", () => {
  const canonical = [...BOUNDED_CONTEXT_TYPES];

  it("the canonical set includes the historically-dropped values", () => {
    assert.ok(canonical.includes("driver"));
    assert.ok(canonical.includes("generic"));
  });

  it("hexagen_create_context `type` enum equals BOUNDED_CONTEXT_TYPES", () => {
    assert.deepStrictEqual(
      contextTypeEnum(createContextTool, "type"),
      canonical,
    );
  });

  it("hexagen_scaffold_module `context_type` enum equals BOUNDED_CONTEXT_TYPES", () => {
    assert.deepStrictEqual(
      contextTypeEnum(scaffoldModuleTool, "context_type"),
      canonical,
    );
  });
});
