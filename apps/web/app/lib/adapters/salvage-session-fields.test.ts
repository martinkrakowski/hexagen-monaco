import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { LoggerPort } from "@hexagen/shared";
import {
  salvageSessionLayerFields,
  salvageSessionTurnFields,
} from "./salvage-session-fields";
import { normalizeLayers } from "./idb-saved-projects.adapter";

/** Minimal LoggerPort capturing warn messages. Does not stub the salvage fns. */
function warnCollector(): { warns: string[]; logger: LoggerPort } {
  const warns: string[] = [];
  const logger: LoggerPort = {
    info: () => {},
    warn: (msg: string) => {
      warns.push(msg);
    },
    error: () => {},
    debug: () => {},
    errorWithException: () => {},
  };
  return { warns, logger };
}

const LAYER_ID = "L-session";

const VALID_STATUSES = [
  "proposing",
  "critiquing",
  "revising",
  "awaiting-human",
  "converged",
  "finalizing",
  "done",
] as const;

const VALID_ROLES = ["proposer", "critic", "human", "system"] as const;

describe("salvageSessionLayerFields", () => {
  it("keeps every valid status and a positive finite maxRounds", () => {
    for (const status of VALID_STATUSES) {
      assert.deepStrictEqual(
        salvageSessionLayerFields({ status, maxRounds: 4 }, LAYER_ID),
        { status, maxRounds: 4 },
      );
    }
  });

  it("leaves absent fields absent (no undefined keys injected)", () => {
    const out = salvageSessionLayerFields({}, LAYER_ID);
    assert.ok(!("status" in out));
    assert.ok(!("maxRounds" in out));
    assert.deepStrictEqual(out, {});
  });

  it("drops invalid status with the load-perimeter warn; other fields stay", () => {
    const { warns, logger } = warnCollector();
    const out = salvageSessionLayerFields(
      { status: "meditating", maxRounds: 3 },
      LAYER_ID,
      logger,
    );
    assert.ok(!("status" in out));
    assert.strictEqual(out.maxRounds, 3);
    assert.deepStrictEqual(warns, [
      `[saved-projects] dropping invalid status on ${LAYER_ID} (layer kept)`,
    ]);
  });

  it("drops invalid maxRounds with the load-perimeter warn; other fields stay", () => {
    const { warns, logger } = warnCollector();
    for (const maxRounds of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "4",
    ]) {
      warns.length = 0;
      const out = salvageSessionLayerFields(
        { status: "done", maxRounds },
        LAYER_ID,
        logger,
      );
      assert.strictEqual(out.status, "done");
      assert.ok(!("maxRounds" in out), `maxRounds=${String(maxRounds)}`);
      assert.deepStrictEqual(warns, [
        `[saved-projects] dropping invalid maxRounds on ${LAYER_ID} (layer kept)`,
      ]);
    }
  });

  it("does not throw when logger is omitted", () => {
    assert.deepStrictEqual(
      salvageSessionLayerFields({ status: "nope", maxRounds: 0 }, LAYER_ID),
      {},
    );
  });
});

describe("salvageSessionTurnFields", () => {
  it("keeps every valid role and a finite round", () => {
    for (const role of VALID_ROLES) {
      assert.deepStrictEqual(
        salvageSessionTurnFields({ role, round: 2 }, LAYER_ID),
        { role, round: 2 },
      );
    }
    // Current contract: any finite number, including 0.
    assert.deepStrictEqual(
      salvageSessionTurnFields({ role: "human", round: 0 }, LAYER_ID),
      { role: "human", round: 0 },
    );
  });

  it("leaves absent fields absent (no undefined keys injected)", () => {
    const out = salvageSessionTurnFields({}, LAYER_ID);
    assert.ok(!("role" in out));
    assert.ok(!("round" in out));
    assert.deepStrictEqual(out, {});
  });

  it("drops invalid role with the load-perimeter warn; other fields stay", () => {
    const { warns, logger } = warnCollector();
    const out = salvageSessionTurnFields(
      { role: "villain", round: 1 },
      LAYER_ID,
      logger,
    );
    assert.ok(!("role" in out));
    assert.strictEqual(out.round, 1);
    assert.deepStrictEqual(warns, [
      `[saved-projects] dropping invalid turn role on ${LAYER_ID} (turn kept)`,
    ]);
  });

  it("drops invalid round with the load-perimeter warn; other fields stay", () => {
    const { warns, logger } = warnCollector();
    for (const round of [Number.NaN, Number.POSITIVE_INFINITY, "two"]) {
      warns.length = 0;
      const out = salvageSessionTurnFields(
        { role: "critic", round },
        LAYER_ID,
        logger,
      );
      assert.strictEqual(out.role, "critic");
      assert.ok(!("round" in out), `round=${String(round)}`);
      assert.deepStrictEqual(warns, [
        `[saved-projects] dropping invalid turn round on ${LAYER_ID} (turn kept)`,
      ]);
    }
  });
});

describe("normalizeLayers (session salvage composition)", () => {
  it("drops invalid status/maxRounds/role and keeps the layer and turn", () => {
    const { warns, logger } = warnCollector();
    const layers = normalizeLayers(
      [
        {
          id: LAYER_ID,
          title: "keep this layer",
          status: "meditating",
          maxRounds: -1,
          turns: [
            {
              id: "t1",
              author: "AI",
              content: "payload survives",
              role: "villain",
              round: 1,
            },
          ],
        },
      ],
      "p",
      logger,
    );

    assert.strictEqual(layers.length, 1, "layer kept");
    const [layer] = layers;
    assert.strictEqual(layer.id, LAYER_ID);
    assert.strictEqual(layer.title, "keep this layer");
    assert.ok(!("status" in layer));
    assert.ok(!("maxRounds" in layer));
    assert.strictEqual(layer.turns.length, 1, "turn kept");
    assert.strictEqual(layer.turns[0].content, "payload survives");
    assert.ok(!("role" in layer.turns[0]));
    assert.strictEqual(layer.turns[0].round, 1);

    assert.ok(
      warns.includes(
        `[saved-projects] dropping invalid status on ${LAYER_ID} (layer kept)`,
      ),
    );
    assert.ok(
      warns.includes(
        `[saved-projects] dropping invalid maxRounds on ${LAYER_ID} (layer kept)`,
      ),
    );
    assert.ok(
      warns.includes(
        `[saved-projects] dropping invalid turn role on ${LAYER_ID} (turn kept)`,
      ),
    );
  });
});
