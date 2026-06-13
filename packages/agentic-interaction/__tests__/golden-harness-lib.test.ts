import { test, describe } from "node:test";
import assert from "node:assert";
import {
  extractRuleIds,
  judgeFromReport,
  computeStateMetrics,
  percentile,
  summarize,
  evaluateGates,
  renderMarkdown,
  LATENCY_CEILING_MS,
  type RunRecord,
  type HarnessSummary,
} from "../scripts/golden-harness-lib";
import type { PipelineState } from "../src/domain/value-objects/pipeline-state";

describe("extractRuleIds", () => {
  test("extracts, dedupes and sorts R-rule IDs from tagged messages", () => {
    assert.deepStrictEqual(
      extractRuleIds([
        "[R07] context X has no inbound port",
        "[R01] context named after a layer",
        "R07 repeated elsewhere",
      ]),
      ["R01", "R07"],
    );
  });

  test("token-boundary: R123 and xR01 do not produce matches; bare R01 does", () => {
    assert.deepStrictEqual(extractRuleIds(["rule R123 is not ours"]), []);
    assert.deepStrictEqual(extractRuleIds(["wordxR01x glued"]), []);
    assert.deepStrictEqual(extractRuleIds(["violates R01."]), ["R01"]);
  });

  test("empty input yields empty output", () => {
    assert.deepStrictEqual(extractRuleIds([]), []);
  });
});

describe("judgeFromReport", () => {
  test("maps a ValidationReport to counts and rule IDs across errors AND warnings", () => {
    const judge = judgeFromReport({
      passed: false,
      errors: ["[R03] port missing justification"],
      warnings: ["[R12] consider splitting context", "untagged warning"],
    });
    assert.deepStrictEqual(judge, {
      passed: false,
      errorCount: 1,
      warningCount: 2,
      ruleIds: ["R03", "R12"],
    });
  });
});

describe("computeStateMetrics", () => {
  const fullState: PipelineState = {
    stage2: {
      accepted: [
        { name: "order-management", type: "core", reasoning: "r" },
        { name: "billing", type: "supporting", reasoning: "r" },
      ],
      rejected: [],
      uncertain: [],
    },
    stage3: {
      contexts: [
        {
          contextName: "order-management",
          in: [{ name: "PlaceOrderPort", type: "command", description: "d" }],
          out: [
            {
              name: "OrderRepositoryPort",
              type: "repository",
              description: "d",
            },
          ],
        },
        {
          contextName: "billing",
          in: [{ name: "IssueInvoicePort", type: "command", description: "d" }],
          out: [],
        },
      ],
    },
    stage4: {
      contexts: [
        {
          contextName: "order-management",
          adapters: [
            {
              name: "OrderRepositoryAdapter",
              type: "driven",
              implements: "OrderRepositoryPort",
            },
          ],
        },
      ],
    },
    stage5: {
      yaml: "workspace:\n  name: shop\n",
      parsedObject: { workspace: { name: "shop" } },
    },
  };

  test("counts contexts, ports, adapters and validates the YAML", () => {
    const metrics = computeStateMetrics(fullState);
    assert.strictEqual(metrics.contextCount, 2);
    assert.strictEqual(metrics.portCount, 3);
    assert.strictEqual(metrics.adapterCount, 1);
    assert.strictEqual(metrics.yamlParses, true);
    assert.ok(metrics.yamlBytes > 0);
    assert.deepStrictEqual(metrics.bannedContextNames, []);
    assert.deepStrictEqual(metrics.unmatchedAdapterImplements, []);
  });

  test("empty state degrades to zeros, not throws", () => {
    const metrics = computeStateMetrics({});
    assert.deepStrictEqual(metrics, {
      contextCount: 0,
      portCount: 0,
      adapterCount: 0,
      yamlParses: false,
      yamlBytes: 0,
      bannedContextNames: [],
      unmatchedAdapterImplements: [],
    });
  });

  test("flags banned context names via the deterministic blocklist", () => {
    const metrics = computeStateMetrics({
      stage2: {
        accepted: [
          // "postgres" and "gateway" are banned tokens; "restaurant-booking"
          // exercises the "rest" prose-only carve-out (must NOT be flagged).
          { name: "postgres-store", type: "core", reasoning: "r" },
          { name: "payment-gateway", type: "core", reasoning: "r" },
          { name: "restaurant-booking", type: "core", reasoning: "r" },
        ],
        rejected: [],
        uncertain: [],
      },
    });
    assert.deepStrictEqual(metrics.bannedContextNames, [
      "postgres-store",
      "payment-gateway",
    ]);
  });

  test("non-parsing or empty YAML reports yamlParses=false", () => {
    const broken = computeStateMetrics({
      stage5: { yaml: "key: [unclosed", parsedObject: {} },
    });
    assert.strictEqual(broken.yamlParses, false);
    const empty = computeStateMetrics({
      stage5: { yaml: "   ", parsedObject: {} },
    });
    assert.strictEqual(empty.yamlParses, false);
  });

  test("bare-scalar YAML (valid YAML, not a manifest) reports yamlParses=false", () => {
    // yaml.load("just text") succeeds but yields a string — the object check
    // is what rejects it, not a parse error.
    const scalar = computeStateMetrics({
      stage5: { yaml: "just some prose, no mapping", parsedObject: {} },
    });
    assert.strictEqual(scalar.yamlParses, false);
  });

  test("adapter implements matching is context-scoped, normalized and case-insensitive", () => {
    const metrics = computeStateMetrics({
      stage3: {
        contexts: [
          {
            // Different surface casing than stage4 — normalizeContextName
            // must bridge "OrderManagement" ↔ "order-management".
            contextName: "OrderManagement",
            in: [],
            out: [
              {
                name: "OrderRepositoryPort",
                type: "repository",
                description: "d",
              },
            ],
          },
        ],
      },
      stage4: {
        contexts: [
          {
            contextName: "order-management",
            adapters: [
              {
                name: "OrderRepoAdapter",
                type: "driven",
                implements: "orderrepositoryport", // case-insensitive match
              },
              {
                name: "GhostAdapter",
                type: "driven",
                implements: "NoSuchPort",
              },
            ],
          },
          {
            contextName: "orphan-context", // no stage3 entry at all
            adapters: [
              {
                name: "OrphanAdapter",
                type: "driven",
                implements: "AnythingPort",
              },
            ],
          },
        ],
      },
    });
    assert.deepStrictEqual(metrics.unmatchedAdapterImplements, [
      "order-management/GhostAdapter→NoSuchPort",
      "orphan-context/OrphanAdapter→AnythingPort",
    ]);
  });
});

describe("percentile", () => {
  test("empty input returns 0", () => {
    assert.strictEqual(percentile([], 95), 0);
  });

  test("single value is every percentile", () => {
    assert.strictEqual(percentile([42], 50), 42);
    assert.strictEqual(percentile([42], 95), 42);
  });

  test("nearest-rank over an unsorted input", () => {
    const values = [50, 10, 40, 20, 30, 60, 70, 80, 90, 100];
    assert.strictEqual(percentile(values, 50), 50);
    assert.strictEqual(percentile(values, 95), 100);
    assert.strictEqual(percentile(values, 90), 90);
  });

  test("does not mutate its input", () => {
    const values = [3, 1, 2];
    percentile(values, 50);
    assert.deepStrictEqual(values, [3, 1, 2]);
  });
});

function run(partial: Partial<RunRecord>): RunRecord {
  return {
    promptId: "p",
    success: true,
    durationMs: 100,
    metrics: {
      contextCount: 2,
      portCount: 4,
      adapterCount: 2,
      yamlParses: true,
      yamlBytes: 100,
      bannedContextNames: [],
      unmatchedAdapterImplements: [],
    },
    judge: { passed: true, errorCount: 0, warningCount: 0, ruleIds: [] },
    ...partial,
  };
}

describe("summarize", () => {
  test("computes rates and percentiles over the run set", () => {
    const runs: RunRecord[] = [
      run({ durationMs: 100 }),
      run({ durationMs: 300 }),
      run({
        success: false,
        durationMs: 5,
        error: "boom",
        metrics: undefined,
        judge: undefined,
      }),
    ];
    const s = summarize(runs);
    assert.strictEqual(s.total, 3);
    assert.strictEqual(s.successCount, 2);
    assert.ok(Math.abs(s.successRate - 2 / 3) < 1e-9);
    // Failure durations are excluded from latency percentiles.
    assert.strictEqual(s.p50DurationMs, 100);
    assert.strictEqual(s.p95DurationMs, 300);
    assert.strictEqual(s.judgedCount, 2);
    assert.strictEqual(s.judgePassRate, 1);
  });

  test("counts banned names and zero-context successes for the gates", () => {
    const runs: RunRecord[] = [
      run({
        metrics: {
          contextCount: 0,
          portCount: 0,
          adapterCount: 0,
          yamlParses: true,
          yamlBytes: 10,
          bannedContextNames: ["postgres-store"],
          unmatchedAdapterImplements: [],
        },
      }),
    ];
    const s = summarize(runs);
    assert.strictEqual(s.bannedNameCount, 1);
    assert.strictEqual(s.zeroContextSuccesses, 1);
  });

  test("a success whose judge errored is excluded from judgedCount, not counted as a fail", () => {
    const runs: RunRecord[] = [
      run({}), // judged, passed
      run({ judge: undefined }), // success, judge errored
    ];
    const s = summarize(runs);
    assert.strictEqual(s.successCount, 2);
    assert.strictEqual(s.judgedCount, 1);
    assert.strictEqual(s.judgePassCount, 1);
    // Denominator is judgedCount, not successCount: 1/1, not 1/2.
    assert.strictEqual(s.judgePassRate, 1);
  });

  test("empty run set yields all-zero summary (no NaN division)", () => {
    const s = summarize([]);
    assert.strictEqual(s.total, 0);
    assert.strictEqual(s.successRate, 0);
    assert.strictEqual(s.judgePassRate, 0);
    assert.strictEqual(s.p95DurationMs, 0);
  });
});

function summary(partial: Partial<HarnessSummary>): HarnessSummary {
  return {
    total: 10,
    successCount: 10,
    successRate: 1,
    p50DurationMs: 1000,
    p95DurationMs: 2000,
    judgedCount: 10,
    judgePassCount: 10,
    judgePassRate: 1,
    bannedNameCount: 0,
    zeroContextSuccesses: 0,
    ...partial,
  };
}

describe("evaluateGates", () => {
  test("all gates pass for a clean full run set", () => {
    const gates = evaluateGates(summary({}));
    assert.deepStrictEqual(
      gates.map((g) => [g.id, g.passed]),
      [
        ["G1", true],
        ["G2", true],
        ["G3", true],
        ["G4", true],
      ],
    );
  });

  test("G1 latency passes at the ceiling (≤, not <) and fails 1ms over", () => {
    const atCeiling = evaluateGates(
      summary({ p95DurationMs: LATENCY_CEILING_MS }),
    );
    assert.strictEqual(atCeiling[0]?.passed, true);
    const overCeiling = evaluateGates(
      summary({ p95DurationMs: LATENCY_CEILING_MS + 1 }),
    );
    assert.strictEqual(overCeiling[0]?.passed, false);
  });

  test("G2 quality fails on any judge failure (rate < 100%)", () => {
    const gates = evaluateGates(
      summary({ judgePassCount: 9, judgePassRate: 0.9 }),
    );
    assert.strictEqual(gates[1]?.passed, false);
  });

  test("G2 fails (not evaluable) when a success went unjudged", () => {
    // judgedCount < successCount: a success whose judge errored leaves an
    // uncertified manifest, so the gate cannot pass on partial coverage — it
    // fails as not-evaluable rather than passing on the runs that were judged.
    const gates = evaluateGates(
      summary({
        successCount: 10,
        judgedCount: 9,
        judgePassCount: 9,
        judgePassRate: 1,
      }),
    );
    assert.strictEqual(gates[1]?.passed, false);
    assert.match(gates[1]?.detail ?? "", /certified only 9\/10/);
    assert.match(gates[1]?.detail ?? "", /not evaluable/);
  });

  test("G3 naming fails on any banned context name", () => {
    const gates = evaluateGates(summary({ bannedNameCount: 1 }));
    assert.strictEqual(gates[2]?.passed, false);
  });

  test("G4 empty fails on any zero-context success", () => {
    const gates = evaluateGates(summary({ zeroContextSuccesses: 1 }));
    assert.strictEqual(gates[3]?.passed, false);
  });

  test("no runs at all fails every gate explicitly", () => {
    const gates = evaluateGates(
      summary({ total: 0, successCount: 0, successRate: 0 }),
    );
    assert.strictEqual(gates.length, 4);
    for (const gate of gates) {
      assert.strictEqual(gate.passed, false);
      assert.match(gate.detail, /no pipeline runs/);
    }
  });

  test("runs but ZERO successes (e.g. invalid API key) fails every gate", () => {
    // Without the precondition: p95 0 → G1 trivially passes, judge 0/0 → G2
    // vacuous, banned 0 → G3 passes, zero-context 0 → G4 passes. An all-error
    // run set must never exit green.
    const gates = evaluateGates(
      summary({
        successCount: 0,
        successRate: 0,
        p50DurationMs: 0,
        p95DurationMs: 0,
        judgedCount: 0,
        judgePassCount: 0,
        judgePassRate: 0,
      }),
    );
    assert.strictEqual(gates.length, 4);
    for (const gate of gates) {
      assert.strictEqual(gate.passed, false);
      assert.match(gate.detail, /no successful runs to certify/);
    }
  });
});

describe("renderMarkdown", () => {
  test("renders gates, summary and per-run rows", () => {
    const runs: RunRecord[] = [
      run({ promptId: "ecommerce" }),
      run({
        promptId: "ecommerce",
        success: false,
        error: "stage 2 accepted no contexts",
        metrics: undefined,
        judge: undefined,
      }),
    ];
    const s = summarize(runs);
    const report = renderMarkdown(
      s,
      evaluateGates(s),
      runs,
      "2026-06-10T00:00:00.000Z",
    );
    assert.match(report, /Generated: 2026-06-10T00:00:00\.000Z/);
    assert.match(report, /## Quality gates \(full pipeline\)/);
    assert.match(report, /\| G1 \|/);
    assert.match(report, /\| ecommerce \| ERROR \|/); // failed run row
    assert.match(report, /stage 2 accepted no contexts/);
  });

  test("is deterministic: identical inputs yield byte-identical reports", () => {
    const runs: RunRecord[] = [run({})];
    const s = summarize(runs);
    const render = () =>
      renderMarkdown(s, evaluateGates(s), runs, "2026-06-10T00:00:00.000Z");
    assert.strictEqual(render(), render());
  });

  test("escapes pipes and newlines in free-text notes so table rows stay intact", () => {
    const runs: RunRecord[] = [
      run({}),
      run({
        success: false,
        error: "provider said: a | b\nsecond line",
        metrics: undefined,
        judge: undefined,
      }),
    ];
    const s = summarize(runs);
    const report = renderMarkdown(
      s,
      evaluateGates(s),
      runs,
      "2026-06-10T00:00:00.000Z",
    );
    assert.match(report, /provider said: a \\\| b second line/);
    // Every line of the Runs table keeps its 10-column shape (11 pipes).
    const runRows = report
      .split("\n")
      .filter((line) => line.startsWith("| p |"));
    assert.strictEqual(runRows.length, 2);
    for (const row of runRows) {
      assert.strictEqual((row.match(/(?<!\\)\|/g) ?? []).length, 11);
    }
  });
});
