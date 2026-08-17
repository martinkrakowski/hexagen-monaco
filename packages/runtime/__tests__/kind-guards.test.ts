import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  NodeKind,
  EdgeKind,
  EDGE_DIRECTIONALITY,
  type EdgeDirectionality,
} from "@hexagen/core-domain";
import { isNodeKind, isEdgeKind, getEdgeDirectionality } from "../src/index.js";

/**
 * `@hexagen/runtime` exists because MVK's kind enums are IR-clean: the enums
 * live in `@hexagen/core-domain` and every runtime narrowing over them lives
 * here. The guards are therefore only correct RELATIVE to those enums, so the
 * suite is driven by the real enums rather than by a copied list of strings —
 * a kind added to `core-domain` that its guard does not accept fails here.
 *
 * Imports go through this package's own barrel (`src/index.ts`), which is the
 * surface a consumer gets, not through the individual modules.
 */

describe("isNodeKind", () => {
  it("accepts every member of the NodeKind enum", () => {
    const values = Object.values(NodeKind);
    assert.ok(values.length > 0, "NodeKind must not be empty");

    for (const value of values) {
      assert.equal(isNodeKind(value), true, `rejected NodeKind ${value}`);
    }
  });

  it("rejects a plausible name that is not in the enum", () => {
    assert.equal(isNodeKind("Component"), false);
    assert.equal(isNodeKind("Module"), false);
  });

  it("is case-sensitive — the enum values are the contract", () => {
    assert.equal(isNodeKind("boundedcontext"), false);
    assert.equal(isNodeKind("BOUNDEDCONTEXT"), false);
  });

  it("rejects non-strings, including a value that stringifies to a real kind", () => {
    assert.equal(isNodeKind(null), false);
    assert.equal(isNodeKind(undefined), false);
    assert.equal(isNodeKind(42), false);
    assert.equal(isNodeKind(["Entity"]), false);
    assert.equal(isNodeKind({ toString: () => "Entity" }), false);
  });

  it("rejects the empty string", () => {
    assert.equal(isNodeKind(""), false);
  });
});

describe("isEdgeKind", () => {
  it("accepts every member of the EdgeKind enum", () => {
    const values = Object.values(EdgeKind);
    assert.ok(values.length > 0, "EdgeKind must not be empty");

    for (const value of values) {
      assert.equal(isEdgeKind(value), true, `rejected EdgeKind ${value}`);
    }
  });

  it("does not confuse a NodeKind for an EdgeKind", () => {
    assert.equal(isEdgeKind(NodeKind.Entity), false);
    assert.equal(isEdgeKind(NodeKind.Port), false);
  });

  it("rejects non-strings and unknown names", () => {
    assert.equal(isEdgeKind(null), false);
    assert.equal(isEdgeKind(0), false);
    assert.equal(isEdgeKind("Association"), false);
  });
});

describe("getEdgeDirectionality", () => {
  const DIRECTIONALITIES: readonly EdgeDirectionality[] = [
    "directed",
    "undirected",
    "bidirectional",
  ];

  it("answers for EVERY edge kind — no kind falls through the table", () => {
    for (const kind of Object.values(EdgeKind)) {
      const directionality = getEdgeDirectionality(kind);
      assert.ok(
        DIRECTIONALITIES.includes(directionality),
        `EdgeKind ${kind} has no directionality (${String(directionality)})`,
      );
    }
  });

  it("reports PortBinding as bidirectional — a port binds both ways", () => {
    assert.equal(getEdgeDirectionality(EdgeKind.PortBinding), "bidirectional");
  });

  it("reports the structural and behavioral kinds as directed", () => {
    assert.equal(getEdgeDirectionality(EdgeKind.Composition), "directed");
    assert.equal(getEdgeDirectionality(EdgeKind.Invocation), "directed");
    assert.equal(
      getEdgeDirectionality(EdgeKind.AdapterImplementation),
      "directed",
    );
  });

  it("PortBinding is the ONLY non-directed kind — a new exception must be argued for", () => {
    const nonDirected = Object.values(EdgeKind).filter(
      (kind) => getEdgeDirectionality(kind) !== "directed",
    );

    assert.deepEqual(nonDirected, [EdgeKind.PortBinding]);
  });

  it("reads the same table core-domain publishes, not a copy", () => {
    for (const kind of Object.values(EdgeKind)) {
      assert.equal(getEdgeDirectionality(kind), EDGE_DIRECTIONALITY[kind]);
    }
  });
});
