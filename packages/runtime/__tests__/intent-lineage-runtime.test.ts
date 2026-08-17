import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { IntentLineage } from "@hexagen/core-domain";
import { generateIntentId, isIntentLineage } from "../src/index.js";

/**
 * `isIntentLineage` is the only thing standing between a decoded payload and
 * code that treats it as a causal chain, so what matters is what it REFUSES.
 * Each rejection below removes exactly one required field or corrupts exactly
 * one type from an otherwise valid lineage, which is the only way to show the
 * check on that field is load-bearing rather than incidental.
 *
 * The fixture is typed as `IntentLineage` from `@hexagen/core-domain`, so a
 * field added to the interface leaves this file failing to compile rather than
 * quietly under-testing the guard.
 */

function validLineage(): IntentLineage {
  return {
    intentId: "intentId_v1",
    timestamp: 1_700_000_000_000,
    origin: { type: "user", actorId: "actor-1" },
    targetContract: { mvkVersion: "1", rrpVersion: "1", remVersion: "1" },
    validation: { valid: true },
  };
}

/** Drops or corrupts one field of an otherwise valid lineage. */
function lineageWithout(mutate: (draft: Record<string, unknown>) => void) {
  const draft = validLineage() as unknown as Record<string, unknown>;
  mutate(draft);
  return draft;
}

describe("generateIntentId", () => {
  it("stamps the version onto the parent id", () => {
    assert.equal(generateIntentId("intentId_v1", 2), "intentId_v1_v2");
  });

  it("uses the conventional root base when there is no parent", () => {
    assert.equal(generateIntentId(undefined, 1), "intentId_v1");
  });

  it("treats an empty parent id as no parent rather than as a base", () => {
    assert.equal(generateIntentId("", 3), "intentId_v3");
  });

  it("accumulates across generations, so the chain is readable from the id", () => {
    const v1 = generateIntentId(undefined, 1);
    const v2 = generateIntentId(v1, 2);
    const v3 = generateIntentId(v2, 3);

    assert.equal(v3, "intentId_v1_v2_v3");
  });
});

describe("isIntentLineage — accepts", () => {
  it("a minimal valid lineage", () => {
    assert.equal(isIntentLineage(validLineage()), true);
  });

  it("each origin the contract allows", () => {
    const system: IntentLineage = {
      ...validLineage(),
      origin: { type: "system", trigger: "reconcile" },
    };
    const llm: IntentLineage = {
      ...validLineage(),
      origin: { type: "llm", modelId: "m", promptHash: "h" },
    };

    assert.equal(isIntentLineage(system), true);
    assert.equal(isIntentLineage(llm), true);
  });

  it("the optional fields when present", () => {
    const withOptionals: IntentLineage = {
      ...validLineage(),
      parentIntentId: "intentId_v1",
      validation: { valid: false, reason: "stale contract" },
    };

    assert.equal(isIntentLineage(withOptionals), true);
  });
});

describe("isIntentLineage — rejects", () => {
  it("a non-object", () => {
    assert.equal(isIntentLineage(null), false);
    assert.equal(isIntentLineage(undefined), false);
    assert.equal(isIntentLineage("intentId_v1"), false);
    assert.equal(isIntentLineage(42), false);
  });

  it("a missing intentId", () => {
    assert.equal(
      isIntentLineage(lineageWithout((d) => delete d.intentId)),
      false,
    );
  });

  it("a timestamp that arrived as a string", () => {
    assert.equal(
      isIntentLineage(
        lineageWithout((d) => {
          d.timestamp = "1700000000000";
        }),
      ),
      false,
    );
  });

  it("an origin type outside the user/system/llm union", () => {
    assert.equal(
      isIntentLineage(
        lineageWithout((d) => {
          d.origin = { type: "bot", actorId: "actor-1" };
        }),
      ),
      false,
    );
  });

  it("a null origin", () => {
    assert.equal(
      isIntentLineage(
        lineageWithout((d) => {
          d.origin = null;
        }),
      ),
      false,
    );
  });

  it("a targetContract missing one of the three versions", () => {
    assert.equal(
      isIntentLineage(
        lineageWithout((d) => {
          d.targetContract = { mvkVersion: "1", rrpVersion: "1" };
        }),
      ),
      false,
    );
  });

  it("a missing validation block", () => {
    assert.equal(
      isIntentLineage(lineageWithout((d) => delete d.validation)),
      false,
    );
  });

  it("a validation.valid that is not a boolean", () => {
    assert.equal(
      isIntentLineage(
        lineageWithout((d) => {
          d.validation = { valid: "true" };
        }),
      ),
      false,
    );
  });

  it("a parentIntentId of the wrong type — absent is allowed, wrong is not", () => {
    assert.equal(
      isIntentLineage(
        lineageWithout((d) => {
          d.parentIntentId = 1;
        }),
      ),
      false,
    );
  });
});
