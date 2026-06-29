import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { parseYamlToViewData } from "@hexagen/manifest-generation";
import { parseAndValidateFixes } from "../request-context-fixes";

const YAML = `bounded_contexts:
  - name: scene-types
    type: shared-kernel
    description: Type-only contracts.
    layers:
      application:
        ports:
          in: [SceneTypesCommandPort]
          out: [SceneTypesRepositoryPort]
      infrastructure:
        adapters: [SceneTypesRepositoryAdapter]
`;

const ctx = parseYamlToViewData(YAML).contexts.find(
  (c) => c.name === "scene-types",
)!;

describe("parseAndValidateFixes", () => {
  it("keeps fixes whose ops reference real entities, drops the rest", () => {
    const json = JSON.stringify([
      {
        label: "Make scene-types type-only",
        rationale: "A shared-kernel owns no ports or adapters (R09).",
        ops: [
          {
            op: "remove-in-port",
            context: "scene-types",
            name: "SceneTypesCommandPort",
          },
          {
            op: "remove-out-port",
            context: "scene-types",
            name: "SceneTypesRepositoryPort",
          },
          {
            op: "remove-adapter",
            context: "scene-types",
            name: "SceneTypesRepositoryAdapter",
          },
        ],
      },
      {
        // every op references a non-existent entity → whole fix dropped
        label: "Hallucinated",
        rationale: "x",
        ops: [
          {
            op: "remove-in-port",
            context: "scene-types",
            name: "DoesNotExistPort",
          },
        ],
      },
    ]);
    const fixes = parseAndValidateFixes(json, ctx);
    assert.strictEqual(fixes.length, 1);
    assert.strictEqual(fixes[0].label, "Make scene-types type-only");
    assert.strictEqual(fixes[0].ops.length, 3);
  });

  it("drops only the invalid ops within an otherwise-valid fix", () => {
    const json = JSON.stringify([
      {
        label: "Trim",
        ops: [
          {
            op: "remove-adapter",
            context: "scene-types",
            name: "SceneTypesRepositoryAdapter",
          },
          {
            op: "remove-adapter",
            context: "scene-types",
            name: "GhostAdapter",
          },
          {
            op: "remove-in-port",
            context: "other-context",
            name: "SceneTypesCommandPort",
          },
        ],
      },
    ]);
    const fixes = parseAndValidateFixes(json, ctx);
    assert.strictEqual(fixes.length, 1);
    // Only the real, in-context op survives.
    assert.deepStrictEqual(
      fixes[0].ops.map((o) => o.op),
      ["remove-adapter"],
    );
  });

  it("extracts the array from a prose/code-fence wrapper", () => {
    const text =
      'Here are the fixes:\n```json\n[{"label":"L","ops":[{"op":"remove-adapter","context":"scene-types","name":"SceneTypesRepositoryAdapter"}]}]\n```';
    assert.strictEqual(parseAndValidateFixes(text, ctx).length, 1);
  });

  it("ignores stray bracketed tags ([Rxx]) and picks the real fixes array", () => {
    // A naive first-`[`/last-`]` slice would span from `[R09]` to `]`, breaking
    // JSON.parse and surfacing zero fixes.
    const text =
      "Findings: [R09] shared-kernel owns ports; [R03] owns an adapter.\n" +
      'Fixes: [{"label":"Make type-only","ops":[' +
      '{"op":"remove-in-port","context":"scene-types","name":"SceneTypesCommandPort"},' +
      '{"op":"remove-adapter","context":"scene-types","name":"SceneTypesRepositoryAdapter"}]}]';
    const fixes = parseAndValidateFixes(text, ctx);
    assert.strictEqual(fixes.length, 1);
    assert.strictEqual(fixes[0].ops.length, 2);
  });

  it("drops add ops whose target already exists, keeps genuinely-new adds", () => {
    const json = JSON.stringify([
      {
        label: "Add ports",
        ops: [
          // already present on scene-types → no-op, dropped
          {
            op: "add-in-port",
            context: "scene-types",
            name: "SceneTypesCommandPort",
          },
          // new → kept
          {
            op: "add-out-port",
            context: "scene-types",
            name: "AuditTrailPort",
          },
        ],
      },
    ]);
    const fixes = parseAndValidateFixes(json, ctx);
    assert.strictEqual(fixes.length, 1);
    assert.deepStrictEqual(
      fixes[0].ops.map((o) => ("name" in o ? o.name : o.op)),
      ["AuditTrailPort"],
    );
  });

  it("returns [] for non-JSON / empty / non-array output", () => {
    assert.deepStrictEqual(
      parseAndValidateFixes("Orders looks fine.", ctx),
      [],
    );
    assert.deepStrictEqual(parseAndValidateFixes("", ctx), []);
    assert.deepStrictEqual(
      parseAndValidateFixes('{"not":"an array"}', ctx),
      [],
    );
  });
});
