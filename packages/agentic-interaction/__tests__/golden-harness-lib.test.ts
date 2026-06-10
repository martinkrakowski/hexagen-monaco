import { test, describe } from "node:test";
import assert from "node:assert";
import {
  extractRuleIds,
  judgeFromReport,
  computeStateMetrics,
  percentile,
  summarizeRuns,
  evaluateGates,
  renderMarkdown,
  type RunRecord,
  type PipelineSummary,
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

  test("empty state (stub failure shape) degrades to zeros, not throws", () => {
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

function run(
  partial: Partial<RunRecord> & { pipeline: "stub" | "full" },
): RunRecord {
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

describe("summarizeRuns", () => {
  test("computes rates and percentiles from one pipeline's runs only", () => {
    const runs: RunRecord[] = [
      run({ pipeline: "full", durationMs: 100 }),
      run({ pipeline: "full", durationMs: 300 }),
      run({
        pipeline: "full",
        success: false,
        durationMs: 5,
        error: "boom",
        metrics: undefined,
        judge: undefined,
      }),
      run({ pipeline: "stub", durationMs: 9999 }), // must be excluded
    ];
    const summary = summarizeRuns(runs, "full");
    assert.strictEqual(summary.total, 3);
    assert.strictEqual(summary.successCount, 2);
    assert.ok(Math.abs(summary.successRate - 2 / 3) < 1e-9);
    // Failure durations are excluded from latency percentiles.
    assert.strictEqual(summary.p50DurationMs, 100);
    assert.strictEqual(summary.p95DurationMs, 300);
    assert.strictEqual(summary.judgedCount, 2);
    assert.strictEqual(summary.judgePassRate, 1);
  });

  test("counts banned names and zero-context successes for the gates", () => {
    const runs: RunRecord[] = [
      run({
        pipeline: "full",
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
    const summary = summarizeRuns(runs, "full");
    assert.strictEqual(summary.bannedNameCount, 1);
    assert.strictEqual(summary.zeroContextSuccesses, 1);
  });

  test("a success whose judge errored is excluded from judgedCount, not counted as a fail", () => {
    const runs: RunRecord[] = [
      run({ pipeline: "full" }), // judged, passed
      run({ pipeline: "full", judge: undefined }), // success, judge errored
    ];
    const s = summarizeRuns(runs, "full");
    assert.strictEqual(s.successCount, 2);
    assert.strictEqual(s.judgedCount, 1);
    assert.strictEqual(s.judgePassCount, 1);
    // Denominator is judgedCount, not successCount: 1/1, not 1/2.
    assert.strictEqual(s.judgePassRate, 1);
  });

  test("empty pipeline yields all-zero summary (no NaN division)", () => {
    const summary = summarizeRuns([], "full");
    assert.strictEqual(summary.total, 0);
    assert.strictEqual(summary.successRate, 0);
    assert.strictEqual(summary.judgePassRate, 0);
    assert.strictEqual(summary.p95DurationMs, 0);
  });
});

function summary(partial: Partial<PipelineSummary>): PipelineSummary {
  return {
    pipeline: "stub",
    total: 10,
    successCount: 10,
    successRate: 1,
    p50DurationMs: 1000,
    p95DurationMs: 2000,
    judgedCount: 10,
    judgePassCount: 9,
    judgePassRate: 0.9,
    bannedNameCount: 0,
    zeroContextSuccesses: 0,
    ...partial,
  };
}

describe("evaluateGates", () => {
  test("all gates pass when full matches stub", () => {
    const gates = evaluateGates(summary({}), summary({ pipeline: "full" }));
    assert.deepStrictEqual(
      gates.map((g) => [g.id, g.passed]),
      [
        ["T1", true],
        ["T2", true],
        ["T3", true],
        ["T4", true],
      ],
    );
  });

  test("T1 fails when full success-rate drops more than 10pp below stub", () => {
    const gates = evaluateGates(
      summary({ successRate: 0.9 }),
      summary({ pipeline: "full", successRate: 0.79 }),
    );
    assert.strictEqual(gates[0]?.passed, false);
    // Exactly at the floor passes (≥, not >).
    const atFloor = evaluateGates(
      summary({ successRate: 0.9 }),
      summary({ pipeline: "full", successRate: 0.8 }),
    );
    assert.strictEqual(atFloor[0]?.passed, true);
    // Interior of the tolerance band (−5pp) passes too.
    const within = evaluateGates(
      summary({ successRate: 0.9 }),
      summary({ pipeline: "full", successRate: 0.85 }),
    );
    assert.strictEqual(within[0]?.passed, true);
  });

  test("T1 clamped display floor matches the gate verdict when stub < 10%", () => {
    // Unclamped floor would be −5pp; successRate ≥ 0 makes "≥ −5pp" and
    // "≥ 0" the same boundary, so the displayed 0.0% floor is the
    // effective threshold — verdict and detail agree.
    const gates = evaluateGates(
      summary({ successCount: 1, successRate: 0.05 }),
      summary({ pipeline: "full", successCount: 0, successRate: 0 }),
    );
    assert.strictEqual(gates[0]?.passed, true);
    assert.match(gates[0]?.detail ?? "", /floor 0\.0%/);
  });

  test("T2 fails when full p95 exceeds 2× stub p95; 0ms stub p95 is not evaluable (pass)", () => {
    const slow = evaluateGates(
      summary({ p95DurationMs: 1000 }),
      summary({ pipeline: "full", p95DurationMs: 2001 }),
    );
    assert.strictEqual(slow[1]?.passed, false);
    const boundary = evaluateGates(
      summary({ p95DurationMs: 1000 }),
      summary({ pipeline: "full", p95DurationMs: 2000 }),
    );
    assert.strictEqual(boundary[1]?.passed, true);
    const degenerate = evaluateGates(
      summary({ p95DurationMs: 0 }),
      summary({ pipeline: "full", p95DurationMs: 5000 }),
    );
    assert.strictEqual(degenerate[1]?.passed, true);
    assert.match(degenerate[1]?.detail ?? "", /not evaluable/);
  });

  test("T3 fails on judge pass-rate regression OR any banned context name", () => {
    const regressed = evaluateGates(
      summary({ judgePassRate: 0.9 }),
      summary({ pipeline: "full", judgePassRate: 0.85 }),
    );
    assert.strictEqual(regressed[2]?.passed, false);
    const banned = evaluateGates(
      summary({}),
      summary({ pipeline: "full", judgePassRate: 1, bannedNameCount: 1 }),
    );
    assert.strictEqual(banned[2]?.passed, false);
  });

  test("T3 passes when full STRICTLY exceeds stub (≥, not ===)", () => {
    const gates = evaluateGates(
      summary({ judgePassRate: 0.9 }),
      summary({
        pipeline: "full",
        judgePassCount: 10,
        judgePassRate: 1,
        bannedNameCount: 0,
      }),
    );
    assert.strictEqual(gates[2]?.passed, true);
  });

  test("T3 fails (not vacuously passes) when a pipeline has successes but zero judge verdicts", () => {
    // Both judges broken: judgePassRate is 0/0 → 0 on both sides, so the
    // bare rate comparison would pass 0 ≥ 0. The evaluability clause must
    // fail it instead.
    const bothBroken = evaluateGates(
      summary({ judgedCount: 0, judgePassCount: 0, judgePassRate: 0 }),
      summary({
        pipeline: "full",
        judgedCount: 0,
        judgePassCount: 0,
        judgePassRate: 0,
      }),
    );
    assert.strictEqual(bothBroken[2]?.passed, false);
    assert.match(bothBroken[2]?.detail ?? "", /stub and full/);
    assert.match(bothBroken[2]?.detail ?? "", /not evaluable/);

    // Only the full-side judge broken.
    const fullBroken = evaluateGates(
      summary({}),
      summary({
        pipeline: "full",
        judgedCount: 0,
        judgePassCount: 0,
        judgePassRate: 0,
      }),
    );
    assert.strictEqual(fullBroken[2]?.passed, false);
    assert.match(fullBroken[2]?.detail ?? "", /full successes/);

    // Only the stub-side judge broken — full could not prove non-regression.
    const stubBroken = evaluateGates(
      summary({ judgedCount: 0, judgePassCount: 0, judgePassRate: 0 }),
      summary({ pipeline: "full" }),
    );
    assert.strictEqual(stubBroken[2]?.passed, false);
    assert.match(stubBroken[2]?.detail ?? "", /stub successes/);
  });

  test("T4 fails on any zero-context full success", () => {
    const gates = evaluateGates(
      summary({}),
      summary({ pipeline: "full", zeroContextSuccesses: 1 }),
    );
    assert.strictEqual(gates[3]?.passed, false);
  });

  test("no full runs at all fails every gate explicitly", () => {
    const gates = evaluateGates(
      summary({}),
      summary({ pipeline: "full", total: 0 }),
    );
    assert.strictEqual(gates.length, 4);
    for (const gate of gates) {
      assert.strictEqual(gate.passed, false);
      assert.match(gate.detail, /no full-pipeline runs/);
    }
  });

  test("no stub runs at all (--pipelines=full) fails every gate explicitly", () => {
    const gates = evaluateGates(
      summary({ total: 0, successCount: 0, successRate: 0 }),
      summary({ pipeline: "full" }),
    );
    assert.strictEqual(gates.length, 4);
    for (const gate of gates) {
      assert.strictEqual(gate.passed, false);
      assert.match(gate.detail, /no stub baseline/);
    }
  });

  test("stub baseline with ZERO successes (e.g. invalid API key) fails every gate", () => {
    // Without the guard: stub successRate 0 → T1 floor −10pp → trivially
    // passes; stub p95 0 → T2 "not evaluable, pass"; judge 0/0 → T3 0 ≥ 0.
    // An all-error run set must never exit green.
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
      summary({
        pipeline: "full",
        successCount: 0,
        successRate: 0,
        p50DurationMs: 0,
        p95DurationMs: 0,
        judgedCount: 0,
        judgePassCount: 0,
        judgePassRate: 0,
      }),
    );
    for (const gate of gates) {
      assert.strictEqual(gate.passed, false);
      assert.match(gate.detail, /no stub baseline/);
    }
  });
});

describe("renderMarkdown", () => {
  test("renders gates, summaries and per-run rows", () => {
    const runs: RunRecord[] = [
      run({ pipeline: "stub", promptId: "ecommerce" }),
      run({
        pipeline: "full",
        promptId: "ecommerce",
        success: false,
        error: "stage 2 accepted no contexts",
        metrics: undefined,
        judge: undefined,
      }),
    ];
    const stub = summarizeRuns(runs, "stub");
    const full = summarizeRuns(runs, "full");
    const report = renderMarkdown(
      [stub, full],
      evaluateGates(stub, full),
      runs,
      "2026-06-10T00:00:00.000Z",
    );
    assert.match(report, /Generated: 2026-06-10T00:00:00\.000Z/);
    assert.match(report, /## Rollback gates \(A3\)/);
    assert.match(report, /\| T1 \|/);
    assert.match(report, /\| stub \| 1 \|/);
    assert.match(report, /stage 2 accepted no contexts/);
    assert.match(report, /❌ FAIL/); // full run failed → at least one gate trips
  });

  test("is deterministic: identical inputs yield byte-identical reports", () => {
    const runs: RunRecord[] = [run({ pipeline: "stub" })];
    const stub = summarizeRuns(runs, "stub");
    const full = summarizeRuns(runs, "full");
    const render = () =>
      renderMarkdown(
        [stub, full],
        evaluateGates(stub, full),
        runs,
        "2026-06-10T00:00:00.000Z",
      );
    assert.strictEqual(render(), render());
  });

  test("escapes pipes and newlines in free-text notes so table rows stay intact", () => {
    const runs: RunRecord[] = [
      run({ pipeline: "stub" }),
      run({
        pipeline: "full",
        success: false,
        error: "provider said: a | b\nsecond line",
        metrics: undefined,
        judge: undefined,
      }),
    ];
    const stub = summarizeRuns(runs, "stub");
    const full = summarizeRuns(runs, "full");
    const report = renderMarkdown(
      [stub, full],
      evaluateGates(stub, full),
      runs,
      "2026-06-10T00:00:00.000Z",
    );
    assert.match(report, /provider said: a \\\| b second line/);
    // Every line of the Runs table keeps its 11-column shape (12 pipes).
    const runRows = report
      .split("\n")
      .filter((line) => line.startsWith("| p |"));
    assert.strictEqual(runRows.length, 2);
    for (const row of runRows) {
      assert.strictEqual((row.match(/(?<!\\)\|/g) ?? []).length, 12);
    }
  });
});
