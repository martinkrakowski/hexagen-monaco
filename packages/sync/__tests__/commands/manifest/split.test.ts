import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  buildPlaneLookup,
  extractContextData,
} from "../../../src/commands/manifest/split-utils.js";

describe("buildPlaneLookup", () => {
  it("derives reverse lookup from planes map", () => {
    const planes = {
      projection: ["ui", "visualization"],
      core: ["project-configuration"],
    };
    const lookup = buildPlaneLookup(planes);

    assert.strictEqual(lookup.get("ui"), "projection");
    assert.strictEqual(lookup.get("visualization"), "projection");
    assert.strictEqual(lookup.get("project-configuration"), "core");
    assert.strictEqual(lookup.size, 3);
  });

  it("returns empty map for undefined planes", () => {
    const lookup = buildPlaneLookup(undefined);
    assert.strictEqual(lookup.size, 0);
  });

  it("returns empty map for empty planes object", () => {
    const lookup = buildPlaneLookup({});
    assert.strictEqual(lookup.size, 0);
  });
});

describe("extractContextData", () => {
  it("strips index-level keys from raw context data", () => {
    const raw = {
      name: "my-context",
      type: "core",
      system: "hexagen-monaco",
      planes: { core: ["my-context"] },
      bounded_contexts: [],
      apps: [],
      invariants: {},
      agent_instructions: {},
      governance: {},
      relationship_patterns: {},
      monorepo: {},
      workspaceDefaults: {},
      rootFiles: {},
      tsConfigRoot: {},
      eslint: {},
      archInvariants: {},
      linterConfig: {},
      generatorConfig: {},
      turboConfig: {},
      mvk: {},
      legacy_config: "something",
    };
    const result = extractContextData(raw);

    assert.strictEqual(result.name, "my-context");
    assert.strictEqual(result.type, "core");
    assert.strictEqual(result.system, undefined);
    assert.strictEqual(result.planes, undefined);
    assert.strictEqual(
      (result as Record<string, unknown>).bounded_contexts,
      undefined,
    );
    assert.strictEqual((result as Record<string, unknown>).apps, undefined);
    assert.strictEqual(
      (result as Record<string, unknown>).invariants,
      undefined,
    );
    assert.strictEqual(
      (result as Record<string, unknown>).agent_instructions,
      undefined,
    );
    assert.strictEqual(
      (result as Record<string, unknown>).governance,
      undefined,
    );
    assert.strictEqual(
      (result as Record<string, unknown>).relationship_patterns,
      undefined,
    );
    assert.strictEqual((result as Record<string, unknown>).monorepo, undefined);
    assert.strictEqual(
      (result as Record<string, unknown>).workspaceDefaults,
      undefined,
    );
    assert.strictEqual(
      (result as Record<string, unknown>).rootFiles,
      undefined,
    );
    assert.strictEqual(
      (result as Record<string, unknown>).tsConfigRoot,
      undefined,
    );
    assert.strictEqual((result as Record<string, unknown>).eslint, undefined);
    assert.strictEqual(
      (result as Record<string, unknown>).archInvariants,
      undefined,
    );
    assert.strictEqual(
      (result as Record<string, unknown>).linterConfig,
      undefined,
    );
    assert.strictEqual(
      (result as Record<string, unknown>).generatorConfig,
      undefined,
    );
    assert.strictEqual(
      (result as Record<string, unknown>).turboConfig,
      undefined,
    );
    assert.strictEqual((result as Record<string, unknown>).mvk, undefined);
    assert.strictEqual(
      (result as Record<string, unknown>).legacy_config,
      undefined,
    );
  });

  it("preserves context-level keys", () => {
    const raw = {
      name: "shared",
      type: "shared-kernel",
      layers: { domain: { entities: ["Entity1"] } },
      depends_on: ["other-context"],
      wiring: ["port-adapter"],
      generator: { dependencies: { lodash: "^4.0.0" } },
      status: "active",
      relationships: [{ context: "other", pattern: "U/D" }],
    };
    const result = extractContextData(raw);

    assert.strictEqual(result.name, "shared");
    assert.strictEqual(result.type, "shared-kernel");
    assert.deepStrictEqual(result.layers, {
      domain: { entities: ["Entity1"] },
    });
    assert.deepStrictEqual(result.depends_on, ["other-context"]);
    assert.deepStrictEqual(result.wiring, ["port-adapter"]);
    assert.deepStrictEqual(result.generator, {
      dependencies: { lodash: "^4.0.0" },
    });
    assert.strictEqual(result.status, "active");
    assert.deepStrictEqual(result.relationships, [
      { context: "other", pattern: "U/D" },
    ]);
  });

  it("returns empty object for empty input", () => {
    const result = extractContextData({});
    assert.deepStrictEqual(result, {});
  });
});

describe("plane defaulting", () => {
  it("defaults to core when context name is not in lookup", () => {
    const planes = { projection: ["ui"] };
    const lookup = buildPlaneLookup(planes);

    const plane = lookup.get("unknown-context") ?? "core";
    assert.strictEqual(plane, "core");
  });

  it("returns mapped plane when context name exists in lookup", () => {
    const planes = { projection: ["ui", "visualization"] };
    const lookup = buildPlaneLookup(planes);

    const plane = lookup.get("ui") ?? "core";
    assert.strictEqual(plane, "projection");
  });
});
