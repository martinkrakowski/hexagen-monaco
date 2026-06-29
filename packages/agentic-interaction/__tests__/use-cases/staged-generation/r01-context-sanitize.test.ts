import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  sanitizeContextName,
  isBannedContextName,
} from "../../../src/domain/prompts/architecture-contract";
import {
  sanitizeBannedContextNames,
  parseStructuredConfig,
} from "../../../src/application/use-cases/staged-generation/execute-structured-config-generation.use-case";

/**
 * R01 auto-resolve: a context whose name carries a banned technology token
 * (`scene-port-adapter` → "adapter") is deterministically renamed at the source,
 * so the clean name flows through the whole pipeline and R01 never reaches Stage
 * 6/7 — it becomes an adjustment (like R12/R03), not an unfixable error.
 */
describe("sanitizeContextName", () => {
  it("drops the banned token and returns a clean kebab name", () => {
    assert.strictEqual(sanitizeContextName("scene-port-adapter"), "scene-port");
    assert.strictEqual(sanitizeContextName("user-database"), "user");
    assert.strictEqual(
      sanitizeContextName("payment-cache-service"),
      "payment-service",
    );
  });

  it("returns null when every token is banned (nothing to salvage)", () => {
    assert.strictEqual(sanitizeContextName("api-gateway"), null);
    assert.strictEqual(sanitizeContextName("adapter"), null);
  });
});

const CONFIG = [
  "bounded_contexts:",
  "  - name: scene-orchestration",
  "    type: core",
  "    description: Core.",
  "  - name: scene-port-adapter",
  "    type: generic",
  "    description: ThreeJS scene bridge.",
  "  - name: api-gateway", // fully banned → must be left alone
  "    type: generic",
  "    description: Edge.",
  "context_mappings:",
  "  - upstream: scene-orchestration",
  "    downstream: scene-port-adapter",
  "use_cases:",
  "  scene-port-adapter:",
  "    - name: ConfigureScene",
  "",
].join("\n");

describe("sanitizeBannedContextNames", () => {
  it("renames the banned context and rewrites all references", () => {
    const config = parseStructuredConfig(CONFIG);
    const { renamed } = sanitizeBannedContextNames(config);

    assert.deepStrictEqual(
      renamed.map((r) => [r.from, r.to, r.tokens]),
      [["scene-port-adapter", "scene-port", ["adapter"]]],
    );
    // bounded_contexts renamed in place
    assert.ok(config.bounded_contexts.some((c) => c.name === "scene-port"));
    assert.ok(
      !config.bounded_contexts.some((c) => c.name === "scene-port-adapter"),
    );
    // context_mappings rewritten
    assert.strictEqual(config.context_mappings?.[0].downstream, "scene-port");
    // use_cases key rewritten
    assert.ok(config.use_cases?.["scene-port"]);
    assert.ok(!config.use_cases?.["scene-port-adapter"]);
  });

  it("leaves an unsalvageable (fully-banned) name untouched", () => {
    const config = parseStructuredConfig(CONFIG);
    sanitizeBannedContextNames(config);
    assert.ok(config.bounded_contexts.some((c) => c.name === "api-gateway"));
  });

  it("disambiguates when the clean name already exists", () => {
    const config = parseStructuredConfig(
      [
        "bounded_contexts:",
        "  - name: scene-port", // already taken
        "    type: core",
        "    description: A.",
        "  - name: scene-port-adapter", // sanitizes to scene-port → collision
        "    type: generic",
        "    description: B.",
        "",
      ].join("\n"),
    );
    const { renamed } = sanitizeBannedContextNames(config);
    assert.strictEqual(renamed[0].to, "scene-port-2");
    assert.ok(config.bounded_contexts.some((c) => c.name === "scene-port"));
    assert.ok(config.bounded_contexts.some((c) => c.name === "scene-port-2"));
  });

  it("leaves a clean config unchanged (no renames)", () => {
    const config = parseStructuredConfig(
      [
        "bounded_contexts:",
        "  - name: scene-orchestration",
        "    type: core",
        "    description: Core.",
        "",
      ].join("\n"),
    );
    assert.deepStrictEqual(sanitizeBannedContextNames(config).renamed, []);
  });

  it("every renamed name passes the R01 ban check afterwards", () => {
    const config = parseStructuredConfig(CONFIG);
    const { renamed } = sanitizeBannedContextNames(config);
    for (const r of renamed)
      assert.ok(!isBannedContextName(r.to), `${r.to} still banned`);
  });
});
