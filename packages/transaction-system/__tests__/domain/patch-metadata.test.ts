import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { Patch } from "@hexagen/core-domain";
import {
  createPatchMetadata,
  isPatch,
  readPatchMetadata,
  PATCHES_METADATA_KEY,
} from "../../src/domain/patch-metadata.js";

const validPatch: Patch = {
  id: "p1",
  type: "add_node",
  targetId: "node-1",
  payload: { label: "Orders" },
};

describe("createPatchMetadata", () => {
  it("stores the patches under the key the reader looks for", () => {
    const metadata = createPatchMetadata([validPatch]);
    assert.deepEqual(metadata[PATCHES_METADATA_KEY], [validPatch]);
  });

  it("merges pipeline bookkeeping without letting it shadow `patches`", () => {
    // `base` is spread first precisely so a caller cannot overwrite the typed
    // key with an untyped value of their own.
    const metadata = createPatchMetadata([validPatch], {
      intentId: "i-1",
      patches: "hijacked",
    });

    assert.equal(metadata.intentId, "i-1");
    assert.deepEqual(metadata.patches, [validPatch]);
  });

  it("round-trips through the reader", () => {
    const read = readPatchMetadata(createPatchMetadata([validPatch]));
    assert.equal(read.ok, true);
    assert.deepEqual(read.ok && read.patches, [validPatch]);
  });
});

describe("isPatch", () => {
  it("accepts a well-formed patch", () => {
    assert.equal(isPatch(validPatch), true);
  });

  // Each case removes or corrupts exactly ONE field of `Patch`. A predicate
  // that stops checking any single field would let its row through — which is
  // the difference between a type guard and an `as`.
  const rejected: Array<[string, unknown]> = [
    ["null", null],
    ["undefined", undefined],
    ["a string", "add_node"],
    ["an array", []],
    ["missing id", { type: "add_node", targetId: "n", payload: {} }],
    ["non-string id", { id: 1, type: "add_node", targetId: "n", payload: {} }],
    ["missing type", { id: "p", targetId: "n", payload: {} }],
    [
      "an unknown type",
      { id: "p", type: "drop_database", targetId: "n", payload: {} },
    ],
    ["missing targetId", { id: "p", type: "add_node", payload: {} }],
    [
      "non-string targetId",
      { id: "p", type: "add_node", targetId: 7, payload: {} },
    ],
    ["missing payload", { id: "p", type: "add_node", targetId: "n" }],
    [
      "a non-object payload",
      { id: "p", type: "add_node", targetId: "n", payload: "x" },
    ],
    [
      "an array payload",
      { id: "p", type: "add_node", targetId: "n", payload: [] },
    ],
  ];

  for (const [label, value] of rejected) {
    it(`rejects ${label}`, () => {
      assert.equal(isPatch(value), false);
    });
  }

  it("accepts every declared patch type", () => {
    for (const type of [
      "add_node",
      "remove_node",
      "add_edge",
      "remove_edge",
      "update_node",
      "update_edge",
    ]) {
      assert.equal(isPatch({ ...validPatch, type }), true, type);
    }
  });
});

describe("readPatchMetadata", () => {
  it("rejects metadata with no `patches` key rather than defaulting to []", () => {
    // The pre-fix `(tx.metadata.patches ?? []) as Patch[]` read this as an
    // empty patch set, so a broken producer surfaced as a successful
    // zero-patch commit.
    const read = readPatchMetadata({ intentId: "i-1" });

    assert.equal(read.ok, false);
    assert.match(read.ok ? "" : read.reason, /no 'patches' key/);
  });

  it("accepts an empty ARRAY (a real, if boring, modification)", () => {
    const read = readPatchMetadata({ patches: [] });

    assert.equal(read.ok, true);
    assert.deepEqual(read.ok && read.patches, []);
  });

  it("rejects a non-array `patches`, naming the type it got", () => {
    const read = readPatchMetadata({ patches: "oops" });

    assert.equal(read.ok, false);
    assert.match(read.ok ? "" : read.reason, /is string, expected an array/);
  });

  it("reports null distinctly from an object", () => {
    const read = readPatchMetadata({ patches: null });

    assert.equal(read.ok, false);
    assert.match(read.ok ? "" : read.reason, /is null, expected an array/);
  });

  it("rejects an array containing a malformed element, naming its index", () => {
    const read = readPatchMetadata({
      patches: [validPatch, { nope: true }, validPatch],
    });

    assert.equal(read.ok, false);
    assert.match(
      read.ok ? "" : read.reason,
      /'patches'\[1\] is not a well-formed patch/,
    );
  });

  it("returns every element when all are valid (no silent dropping)", () => {
    // The reader rebuilds the array with `.filter(isPatch)` to narrow it. If
    // that filter ever disagreed with the validation loop above it, patches
    // would vanish silently instead of erroring — so pin the count.
    const patches = [
      validPatch,
      { ...validPatch, id: "p2", type: "remove_edge" as const },
      { ...validPatch, id: "p3", type: "update_node" as const },
    ];
    const read = readPatchMetadata({ patches });

    assert.equal(read.ok, true);
    assert.deepEqual(read.ok && read.patches, patches);
  });
});
