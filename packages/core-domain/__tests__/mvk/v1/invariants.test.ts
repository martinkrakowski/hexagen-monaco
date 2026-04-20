import {
  NodeKind,
  EdgeKind,
  TopologyInvariants,
  CardinalityInvariants,
  isAcyclicInvariant,
  isConnectedInvariant,
  isContainmentInvariant,
  isDegreeConstraintInvariant,
  isExactlyInvariant,
  isAtLeastInvariant,
  isAtMostInvariant,
  isBetweenInvariant,
} from "../../../src/mvk/v1/index.js";

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
    payload: { edgeKinds: [EdgeKind.Composition], rootNodeKinds: [NodeKind.Aggregate] },
  };
  const containment: TopologyInvariants = {
    type: "Containment",
    payload: { source: NodeKind.Aggregate, edgeKind: EdgeKind.Composition, target: NodeKind.Entity },
  };
  const degree: TopologyInvariants = {
    type: "DegreeConstraint",
    payload: { edgeKind: EdgeKind.Dependency, min: 0, max: 5, appliesTo: [NodeKind.Entity] },
  };

  it("isAcyclicInvariant narrows Acyclic type", () => {
    expect(isAcyclicInvariant(acyclic)).toBe(true);
    expect(isAcyclicInvariant(connected)).toBe(false);
    expect(isAcyclicInvariant(containment)).toBe(false);
    expect(isAcyclicInvariant(degree)).toBe(false);
  });

  it("isConnectedInvariant narrows Connected type", () => {
    expect(isConnectedInvariant(connected)).toBe(true);
    expect(isConnectedInvariant(acyclic)).toBe(false);
  });

  it("isContainmentInvariant narrows Containment type", () => {
    expect(isContainmentInvariant(containment)).toBe(true);
    expect(isContainmentInvariant(acyclic)).toBe(false);
  });

  it("isDegreeConstraintInvariant narrows DegreeConstraint type", () => {
    expect(isDegreeConstraintInvariant(degree)).toBe(true);
    expect(isDegreeConstraintInvariant(acyclic)).toBe(false);
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
      expect(trueCount).toBe(1);
    }
  });

  it("all topology type strings are accounted for", () => {
    const invariantTypes = [acyclic.type, connected.type, containment.type, degree.type];
    expect(invariantTypes.sort()).toEqual(ALL_TOPOLOGY_TYPES.sort());
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
    expect(isExactlyInvariant(exactly)).toBe(true);
    expect(isExactlyInvariant(atLeast)).toBe(false);
  });

  it("isAtLeastInvariant narrows AtLeast type", () => {
    expect(isAtLeastInvariant(atLeast)).toBe(true);
    expect(isExactlyInvariant(atLeast)).toBe(false);
  });

  it("isAtMostInvariant narrows AtMost type", () => {
    expect(isAtMostInvariant(atMost)).toBe(true);
    expect(isAtLeastInvariant(atMost)).toBe(false);
  });

  it("isBetweenInvariant narrows Between type", () => {
    expect(isBetweenInvariant(between)).toBe(true);
    expect(isExactlyInvariant(between)).toBe(false);
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
      expect(trueCount).toBe(1);
    }
  });

  it("all cardinality type strings are accounted for", () => {
    const invariantTypes = [exactly.type, atLeast.type, atMost.type, between.type];
    expect(invariantTypes.sort()).toEqual(ALL_CARDINALITY_TYPES.sort());
  });
});

describe("NodeKind enum exhaustiveness", () => {
  it("has expected number of values", () => {
    expect(Object.values(NodeKind).length).toBeGreaterThan(0);
  });

  it("all NodeKind values are strings", () => {
    for (const kind of Object.values(NodeKind)) {
      expect(typeof kind).toBe("string");
    }
  });

  it("NodeKind keys match values", () => {
    for (const [key, value] of Object.entries(NodeKind)) {
      expect(key).toBe(value);
    }
  });
});

describe("EdgeKind enum exhaustiveness", () => {
  it("has expected number of values", () => {
    expect(Object.values(EdgeKind).length).toBeGreaterThan(0);
  });

  it("all EdgeKind values are strings", () => {
    for (const kind of Object.values(EdgeKind)) {
      expect(typeof kind).toBe("string");
    }
  });

  it("EdgeKind keys match values", () => {
    for (const [key, value] of Object.entries(EdgeKind)) {
      expect(key).toBe(value);
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
      expect(isAcyclicInvariant(inv)).toBe(true);
      expect(inv.payload.appliesTo).toContain(edgeKind);
    }
  });

  it("Connected invariant accepts all EdgeKind values", () => {
    for (const edgeKind of ALL_EDGE_KINDS) {
      const inv: TopologyInvariants = {
        type: "Connected",
        payload: { edgeKinds: [edgeKind] },
      };
      expect(isConnectedInvariant(inv)).toBe(true);
    }
  });

  it("Containment invariant accepts all NodeKind/EdgeKind combinations", () => {
    for (const source of ALL_NODE_KINDS) {
      for (const target of ALL_NODE_KINDS) {
        const inv: TopologyInvariants = {
          type: "Containment",
          payload: { source, edgeKind: EdgeKind.Composition, target },
        };
        expect(isContainmentInvariant(inv)).toBe(true);
        expect(inv.payload.source).toBe(source);
        expect(inv.payload.target).toBe(target);
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
      expect(isExactlyInvariant(inv)).toBe(true);
      expect(inv.payload.nodeKind).toBe(nodeKind);
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
        expect(isBetweenInvariant(inv)).toBe(true);
        expect(inv.payload.min).toBeLessThanOrEqual(inv.payload.max);
      }
    }
  });
});