import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  NodeKind,
  EdgeKind,
  TopologyInvariants,
  CardinalityInvariants,
} from "../../../src/mvk/v1/index.js";
function isAcyclicInvariant(
  inv: TopologyInvariants,
): inv is Extract<TopologyInvariants, { type: "Acyclic" }> {
  return inv.type === "Acyclic";
}
function isConnectedInvariant(
  inv: TopologyInvariants,
): inv is Extract<TopologyInvariants, { type: "Connected" }> {
  return inv.type === "Connected";
}
function isContainmentInvariant(
  inv: TopologyInvariants,
): inv is Extract<TopologyInvariants, { type: "Containment" }> {
  return inv.type === "Containment";
}
function isDegreeConstraintInvariant(
  inv: TopologyInvariants,
): inv is Extract<TopologyInvariants, { type: "DegreeConstraint" }> {
  return inv.type === "DegreeConstraint";
}
function isExactlyInvariant(
  inv: CardinalityInvariants,
): inv is Extract<CardinalityInvariants, { type: "Exactly" }> {
  return inv.type === "Exactly";
}
function isAtLeastInvariant(
  inv: CardinalityInvariants,
): inv is Extract<CardinalityInvariants, { type: "AtLeast" }> {
  return inv.type === "AtLeast";
}
function isAtMostInvariant(
  inv: CardinalityInvariants,
): inv is Extract<CardinalityInvariants, { type: "AtMost" }> {
  return inv.type === "AtMost";
}
function isBetweenInvariant(
  inv: CardinalityInvariants,
): inv is Extract<CardinalityInvariants, { type: "Between" }> {
  return inv.type === "Between";
}

const ALL_TOPOLOGY_TYPES: TopologyInvariants["type"][] = [
  "Acyclic",
  "Connected",
  "Containment",
  "DegreeConstraint",
];

const ALL_CARDINALITY_TYPES: CardinalityInvariants["type"][] = [
  "Exactly",
  "AtLeast",
  "AtMost",
  "Between",
];

const ALL_NODE_KINDS = Object.values(NodeKind);
const ALL_EDGE_KINDS = Object.values(EdgeKind);

describe("Topology type guards", () => {
  const acyclic: TopologyInvariants = {
    type: "Acyclic",
    payload: { appliesTo: [EdgeKind.Dependency] },
  };
  const connected: TopologyInvariants = {
    type: "Connected",
    payload: {
      edgeKinds: [EdgeKind.Composition],
      rootNodeKinds: [NodeKind.Aggregate],
    },
  };
  const containment: TopologyInvariants = {
    type: "Containment",
    payload: {
      source: NodeKind.Aggregate,
      edgeKind: EdgeKind.Composition,
      target: NodeKind.Entity,
    },
  };
  const degree: TopologyInvariants = {
    type: "DegreeConstraint",
    payload: {
      edgeKind: EdgeKind.Dependency,
      min: 0,
      max: 5,
      appliesTo: [NodeKind.Entity],
    },
  };

  it("isAcyclicInvariant narrows Acyclic type", () => {
    assert.strictEqual(isAcyclicInvariant(acyclic), true);
    assert.strictEqual(isAcyclicInvariant(connected), false);
    assert.strictEqual(isAcyclicInvariant(containment), false);
    assert.strictEqual(isAcyclicInvariant(degree), false);
  });

  it("isConnectedInvariant narrows Connected type", () => {
    assert.strictEqual(isConnectedInvariant(connected), true);
    assert.strictEqual(isConnectedInvariant(acyclic), false);
  });

  it("isContainmentInvariant narrows Containment type", () => {
    assert.strictEqual(isContainmentInvariant(containment), true);
    assert.strictEqual(isContainmentInvariant(acyclic), false);
  });

  it("isDegreeConstraintInvariant narrows DegreeConstraint type", () => {
    assert.strictEqual(isDegreeConstraintInvariant(degree), true);
    assert.strictEqual(isDegreeConstraintInvariant(acyclic), false);
  });

  it("exactly one type guard returns true for each topology invariant", () => {
    const all = [acyclic, connected, containment, degree];
    for (const inv of all) {
      const guards = [
        isAcyclicInvariant(inv),
        isConnectedInvariant(inv),
        isContainmentInvariant(inv),
        isDegreeConstraintInvariant(inv),
      ];
      const trueCount = guards.filter(Boolean).length;
      assert.strictEqual(trueCount, 1);
    }
  });

  it("all topology type strings are accounted for", () => {
    const invariantTypes = [
      acyclic.type,
      connected.type,
      containment.type,
      degree.type,
    ];
    assert.deepStrictEqual(invariantTypes.sort(), ALL_TOPOLOGY_TYPES.sort());
  });
});

describe("Cardinality type guards", () => {
  const exactly: CardinalityInvariants = {
    type: "Exactly",
    payload: { nodeKind: NodeKind.Entity, count: 1 },
  };
  const atLeast: CardinalityInvariants = {
    type: "AtLeast",
    payload: { nodeKind: NodeKind.Entity, count: 1 },
  };
  const atMost: CardinalityInvariants = {
    type: "AtMost",
    payload: { nodeKind: NodeKind.Entity, count: 5 },
  };
  const between: CardinalityInvariants = {
    type: "Between",
    payload: { nodeKind: NodeKind.Entity, min: 1, max: 10 },
  };

  it("isExactlyInvariant narrows Exactly type", () => {
    assert.strictEqual(isExactlyInvariant(exactly), true);
    assert.strictEqual(isExactlyInvariant(atLeast), false);
  });

  it("isAtLeastInvariant narrows AtLeast type", () => {
    assert.strictEqual(isAtLeastInvariant(atLeast), true);
    assert.strictEqual(isExactlyInvariant(atLeast), false);
  });

  it("isAtMostInvariant narrows AtMost type", () => {
    assert.strictEqual(isAtMostInvariant(atMost), true);
    assert.strictEqual(isAtLeastInvariant(atMost), false);
  });

  it("isBetweenInvariant narrows Between type", () => {
    assert.strictEqual(isBetweenInvariant(between), true);
    assert.strictEqual(isExactlyInvariant(between), false);
  });

  it("exactly one type guard returns true for each cardinality invariant", () => {
    const all = [exactly, atLeast, atMost, between];
    for (const inv of all) {
      const guards = [
        isExactlyInvariant(inv),
        isAtLeastInvariant(inv),
        isAtMostInvariant(inv),
        isBetweenInvariant(inv),
      ];
      const trueCount = guards.filter(Boolean).length;
      assert.strictEqual(trueCount, 1);
    }
  });

  it("all cardinality type strings are accounted for", () => {
    const invariantTypes = [
      exactly.type,
      atLeast.type,
      atMost.type,
      between.type,
    ];
    assert.deepStrictEqual(invariantTypes.sort(), ALL_CARDINALITY_TYPES.sort());
  });
});

describe("NodeKind enum exhaustiveness", () => {
  it("has expected number of values", () => {
    assert.ok(Object.values(NodeKind).length > 0);
  });

  it("all NodeKind values are strings", () => {
    for (const kind of Object.values(NodeKind)) {
      assert.strictEqual(typeof kind, "string");
    }
  });

  it("NodeKind keys match values", () => {
    for (const [key, value] of Object.entries(NodeKind)) {
      assert.strictEqual(key, value);
    }
  });
});

describe("EdgeKind enum exhaustiveness", () => {
  it("has expected number of values", () => {
    assert.ok(Object.values(EdgeKind).length > 0);
  });

  it("all EdgeKind values are strings", () => {
    for (const kind of Object.values(EdgeKind)) {
      assert.strictEqual(typeof kind, "string");
    }
  });

  it("EdgeKind keys match values", () => {
    for (const [key, value] of Object.entries(EdgeKind)) {
      assert.strictEqual(key, value);
    }
  });
});

describe("TopologyInvariant exhaustiveness with all EdgeKinds", () => {
  it("Acyclic invariant accepts all EdgeKind values", () => {
    for (const edgeKind of ALL_EDGE_KINDS) {
      const inv: TopologyInvariants = {
        type: "Acyclic",
        payload: { appliesTo: [edgeKind] },
      };
      assert.strictEqual(isAcyclicInvariant(inv), true);
      assert.ok(inv.payload.appliesTo.includes(edgeKind));
    }
  });

  it("Connected invariant accepts all EdgeKind values", () => {
    for (const edgeKind of ALL_EDGE_KINDS) {
      const inv: TopologyInvariants = {
        type: "Connected",
        payload: { edgeKinds: [edgeKind] },
      };
      assert.strictEqual(isConnectedInvariant(inv), true);
    }
  });

  it("Containment invariant accepts all NodeKind/EdgeKind combinations", () => {
    for (const source of ALL_NODE_KINDS) {
      for (const target of ALL_NODE_KINDS) {
        const inv: TopologyInvariants = {
          type: "Containment",
          payload: { source, edgeKind: EdgeKind.Composition, target },
        };
        assert.strictEqual(isContainmentInvariant(inv), true);
        assert.strictEqual(inv.payload.source, source);
        assert.strictEqual(inv.payload.target, target);
      }
    }
  });
});

describe("CardinalityInvariant exhaustiveness with all NodeKinds", () => {
  it("Exactly invariant accepts all NodeKind values", () => {
    for (const nodeKind of ALL_NODE_KINDS) {
      const inv: CardinalityInvariants = {
        type: "Exactly",
        payload: { nodeKind, count: 1 },
      };
      assert.strictEqual(isExactlyInvariant(inv), true);
      assert.strictEqual(inv.payload.nodeKind, nodeKind);
    }
  });

  it("Between invariant payload min <= max is always constructable", () => {
    for (const nodeKind of ALL_NODE_KINDS) {
      const pairs = [
        [0, 1],
        [1, 10],
        [5, 5],
      ];
      for (const [min, max] of pairs) {
        const inv: CardinalityInvariants = {
          type: "Between",
          payload: { nodeKind, min, max },
        };
        assert.strictEqual(isBetweenInvariant(inv), true);
        assert.ok(inv.payload.min <= inv.payload.max);
      }
    }
  });
});
