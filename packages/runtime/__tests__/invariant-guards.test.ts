import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  NodeKind,
  EdgeKind,
  type CardinalityInvariants,
  type TopologyInvariants,
} from "@hexagen/core-domain";
import {
  isExactlyInvariant,
  isAtLeastInvariant,
  isAtMostInvariant,
  isBetweenInvariant,
  isAcyclicInvariant,
  isConnectedInvariant,
  isContainmentInvariant,
  isDegreeConstraintInvariant,
} from "../src/index.js";

/**
 * Eight guards over two discriminated unions, each one line, each differing
 * from its neighbours by a single string literal. That is precisely the shape
 * that copy-paste drift survives silently: a guard that compares against a
 * sibling's tag still returns a boolean, still type-checks (the `Extract<>`
 * return type is asserted, not inferred), and simply routes the wrong branch.
 *
 * So each guard is tested against EVERY member of its union, not just its own:
 * accepting exactly one and rejecting the rest is the property that fails when
 * a literal is wrong.
 *
 * The subjects are typed as the union `core-domain` publishes, so a member
 * added there without a guard leaves this matrix incomplete by construction.
 */

const cardinality: Record<
  CardinalityInvariants["type"],
  CardinalityInvariants
> = {
  Exactly: {
    type: "Exactly",
    payload: { nodeKind: NodeKind.BoundedContext, count: 1 },
  },
  AtLeast: {
    type: "AtLeast",
    payload: { nodeKind: NodeKind.Port, count: 2 },
  },
  AtMost: {
    type: "AtMost",
    payload: { nodeKind: NodeKind.Adapter, count: 5 },
  },
  Between: {
    type: "Between",
    payload: { nodeKind: NodeKind.UseCase, min: 1, max: 3 },
  },
};

const topology: Record<TopologyInvariants["type"], TopologyInvariants> = {
  Acyclic: {
    type: "Acyclic",
    payload: { appliesTo: [EdgeKind.Dependency] },
  },
  Connected: {
    type: "Connected",
    payload: {
      edgeKinds: [EdgeKind.Usage],
      rootNodeKinds: [NodeKind.BoundedContext],
    },
  },
  Containment: {
    type: "Containment",
    payload: {
      source: NodeKind.BoundedContext,
      edgeKind: EdgeKind.Composition,
      target: NodeKind.Entity,
    },
  },
  DegreeConstraint: {
    type: "DegreeConstraint",
    payload: {
      edgeKind: EdgeKind.PortBinding,
      min: 1,
      max: 1,
      appliesTo: [NodeKind.Port],
    },
  },
};

describe("cardinality invariant guards", () => {
  const guards: Record<
    CardinalityInvariants["type"],
    (invariant: CardinalityInvariants) => boolean
  > = {
    Exactly: isExactlyInvariant,
    AtLeast: isAtLeastInvariant,
    AtMost: isAtMostInvariant,
    Between: isBetweenInvariant,
  };

  for (const [name, guard] of Object.entries(guards) as [
    CardinalityInvariants["type"],
    (invariant: CardinalityInvariants) => boolean,
  ][]) {
    it(`is${name}Invariant accepts ${name} and rejects every sibling`, () => {
      for (const [otherName, invariant] of Object.entries(cardinality) as [
        CardinalityInvariants["type"],
        CardinalityInvariants,
      ][]) {
        assert.equal(
          guard(invariant),
          otherName === name,
          `is${name}Invariant answered wrongly for ${otherName}`,
        );
      }
    });
  }

  it("narrows to the variant payload, not merely to a boolean", () => {
    const invariant = cardinality.Between;

    assert.ok(isBetweenInvariant(invariant));
    // Reachable only through the narrowing: `min`/`max` exist on no other
    // member of the union, so this line fails to compile if the guard's
    // asserted `Extract<>` type drifts.
    assert.equal(invariant.payload.min, 1);
    assert.equal(invariant.payload.max, 3);
  });

  it("narrows Exactly to its count payload", () => {
    const invariant = cardinality.Exactly;

    assert.ok(isExactlyInvariant(invariant));
    assert.equal(invariant.payload.count, 1);
    assert.equal(invariant.payload.nodeKind, NodeKind.BoundedContext);
  });
});

describe("topology invariant guards", () => {
  const guards: Record<
    TopologyInvariants["type"],
    (invariant: TopologyInvariants) => boolean
  > = {
    Acyclic: isAcyclicInvariant,
    Connected: isConnectedInvariant,
    Containment: isContainmentInvariant,
    DegreeConstraint: isDegreeConstraintInvariant,
  };

  for (const [name, guard] of Object.entries(guards) as [
    TopologyInvariants["type"],
    (invariant: TopologyInvariants) => boolean,
  ][]) {
    it(`is${name}Invariant accepts ${name} and rejects every sibling`, () => {
      for (const [otherName, invariant] of Object.entries(topology) as [
        TopologyInvariants["type"],
        TopologyInvariants,
      ][]) {
        assert.equal(
          guard(invariant),
          otherName === name,
          `is${name}Invariant answered wrongly for ${otherName}`,
        );
      }
    });
  }

  it("narrows Containment to its source/edge/target payload", () => {
    const invariant = topology.Containment;

    assert.ok(isContainmentInvariant(invariant));
    assert.equal(invariant.payload.source, NodeKind.BoundedContext);
    assert.equal(invariant.payload.edgeKind, EdgeKind.Composition);
    assert.equal(invariant.payload.target, NodeKind.Entity);
  });

  it("narrows DegreeConstraint to its bounds payload", () => {
    const invariant = topology.DegreeConstraint;

    assert.ok(isDegreeConstraintInvariant(invariant));
    assert.equal(invariant.payload.min, 1);
    assert.equal(invariant.payload.max, 1);
    assert.deepEqual(invariant.payload.appliesTo, [NodeKind.Port]);
  });
});
