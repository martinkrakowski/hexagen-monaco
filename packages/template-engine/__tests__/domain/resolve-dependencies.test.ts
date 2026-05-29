import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveDependencies,
  CyclicDependencyError,
  MissingTemplateError,
  ConflictError,
} from "../../src/application/resolve-dependencies.js";
import type {
  AnswerMap,
  ManifestConflict,
  TemplateManifest,
} from "../../src/domain/index.js";

function manifest(
  id: string,
  requires: string[] = [],
  conflicts: ManifestConflict[] = [],
): TemplateManifest {
  return {
    id,
    name: id,
    description: "",
    version: "1.0.0",
    requires,
    conflicts,
    questions: [],
    envVars: [],
    outputs: [],
    checklist: [],
  };
}

function makeRegistry(
  ...manifests: TemplateManifest[]
): Map<string, TemplateManifest> {
  return new Map(manifests.map((m) => [m.id, m]));
}

describe("resolveDependencies", () => {
  it("returns a single template with no deps", () => {
    const registry = makeRegistry(manifest("a"));
    const result = resolveDependencies(["a"], registry);
    assert.deepEqual(result, ["a"]);
  });

  it("includes transitive dependencies in topological order", () => {
    const registry = makeRegistry(
      manifest("a", ["b"]),
      manifest("b", ["c"]),
      manifest("c"),
    );
    const result = resolveDependencies(["a"], registry);
    // c must come before b, b before a
    assert.equal(result.indexOf("c") < result.indexOf("b"), true);
    assert.equal(result.indexOf("b") < result.indexOf("a"), true);
  });

  it("deduplicates shared dependencies", () => {
    const registry = makeRegistry(
      manifest("a", ["c"]),
      manifest("b", ["c"]),
      manifest("c"),
    );
    const result = resolveDependencies(["a", "b"], registry);
    const cCount = result.filter((id) => id === "c").length;
    assert.equal(cCount, 1);
  });

  it("throws MissingTemplateError when a dep is not in the registry", () => {
    const registry = makeRegistry(manifest("a", ["missing"]));
    assert.throws(
      () => resolveDependencies(["a"], registry),
      MissingTemplateError,
    );
  });

  it("reports the actual requirer (not the missing id) for transitive missing deps", () => {
    // a → b → missing; requested is ["a"]; requiredBy should be "b", not "missing"
    const registry = makeRegistry(
      manifest("a", ["b"]),
      manifest("b", ["missing"]),
    );
    let caught: MissingTemplateError | null = null;
    try {
      resolveDependencies(["a"], registry);
    } catch (err) {
      if (err instanceof MissingTemplateError) caught = err;
    }
    assert.ok(caught, "expected MissingTemplateError");
    assert.equal(caught!.templateId, "missing");
    assert.equal(caught!.requiredBy, "b");
  });

  it("throws CyclicDependencyError on a direct cycle", () => {
    const registry = makeRegistry(manifest("a", ["b"]), manifest("b", ["a"]));
    assert.throws(
      () => resolveDependencies(["a"], registry),
      CyclicDependencyError,
    );
  });

  it("throws CyclicDependencyError on an indirect cycle", () => {
    const registry = makeRegistry(
      manifest("a", ["b"]),
      manifest("b", ["c"]),
      manifest("c", ["a"]),
    );
    assert.throws(
      () => resolveDependencies(["a"], registry),
      CyclicDependencyError,
    );
  });

  it("throws ConflictError when two requested templates conflict", () => {
    const registry = makeRegistry(manifest("a", [], ["b"]), manifest("b"));
    assert.throws(
      () => resolveDependencies(["a", "b"], registry),
      ConflictError,
    );
  });

  it("fires a gated conflict when the declaring template's answer satisfies the gate", () => {
    // a's conflict with b is gated on a.features ⊇ {auth}
    const registry = makeRegistry(
      manifest(
        "a",
        [],
        [{ id: "b", when: { answer: "features", includes: "auth" } }],
      ),
      manifest("b"),
    );
    const answers = new Map<string, AnswerMap>([
      ["a", { features: ["auth", "storage"] }],
    ]);
    assert.throws(
      () => resolveDependencies(["a", "b"], registry, answers),
      ConflictError,
    );
  });

  it("skips a gated conflict when the declaring template's answer does not satisfy the gate", () => {
    // Same setup, but features doesn't include "auth" → no conflict
    const registry = makeRegistry(
      manifest(
        "a",
        [],
        [{ id: "b", when: { answer: "features", includes: "auth" } }],
      ),
      manifest("b"),
    );
    const answers = new Map<string, AnswerMap>([
      ["a", { features: ["storage"] }],
    ]);
    const result = resolveDependencies(["a", "b"], registry, answers);
    assert.deepEqual(result.sort(), ["a", "b"]);
  });

  it("treats a gated conflict as inactive when no answers are supplied", () => {
    // Conservative default: without evidence, gates don't fire.
    const registry = makeRegistry(
      manifest(
        "a",
        [],
        [{ id: "b", when: { answer: "features", includes: "auth" } }],
      ),
      manifest("b"),
    );
    const result = resolveDependencies(["a", "b"], registry);
    assert.deepEqual(result.sort(), ["a", "b"]);
  });

  it("fires an unconditional conflict even when the registry has gated entries", () => {
    // Plain-string and gated entries can coexist; the plain one still fires.
    const registry = makeRegistry(
      manifest("a", [], ["b", { id: "c", when: { answer: "x", equals: "y" } }]),
      manifest("b"),
      manifest("c"),
    );
    assert.throws(
      () => resolveDependencies(["a", "b"], registry),
      ConflictError,
    );
  });

  it("evaluates an equals-gated conflict against a boolean answer", () => {
    const registry = makeRegistry(
      manifest(
        "a",
        [],
        [{ id: "b", when: { answer: "ship_auth", equals: true } }],
      ),
      manifest("b"),
    );
    const noShip = new Map<string, AnswerMap>([["a", { ship_auth: false }]]);
    assert.deepEqual(resolveDependencies(["a", "b"], registry, noShip).sort(), [
      "a",
      "b",
    ]);
    const ship = new Map<string, AnswerMap>([["a", { ship_auth: true }]]);
    assert.throws(
      () => resolveDependencies(["a", "b"], registry, ship),
      ConflictError,
    );
  });

  it("resolves multiple roots with shared deps correctly", () => {
    const registry = makeRegistry(
      manifest("env-setup"),
      manifest("rate-limiting", ["env-setup"]),
      manifest("llm-adapter", ["env-setup"]),
    );
    const result = resolveDependencies(
      ["rate-limiting", "llm-adapter"],
      registry,
    );
    assert.equal(result.includes("env-setup"), true);
    assert.equal(result.includes("rate-limiting"), true);
    assert.equal(result.includes("llm-adapter"), true);
    // env-setup must precede both dependents
    const envIdx = result.indexOf("env-setup");
    assert.equal(envIdx < result.indexOf("rate-limiting"), true);
    assert.equal(envIdx < result.indexOf("llm-adapter"), true);
  });
});
