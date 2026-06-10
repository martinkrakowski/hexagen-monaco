/**
 * Pure helpers for the golden-manifest comparison harness (A3 slice 2).
 *
 * The harness runs the same golden prompts through BOTH staged-generation
 * pipelines (stub and full), judges each result with the same Stage-6
 * validation review, and evaluates the quantitative rollback gates T1–T4
 * defined in docs/planning/normalizer-rewire-development-plan.md (A3).
 *
 * Everything in this module is deterministic and side-effect free so it can
 * be unit-tested without an LLM; the runner
 * (golden-manifest-harness.ts) owns I/O and provider wiring.
 */

import yaml from "js-yaml";
import type {
  PipelineState,
  ValidationReport,
} from "../src/domain/value-objects/pipeline-state";
import { isBannedContextName } from "../src/domain/prompts/architecture-contract";
import { normalizeContextName } from "../src/domain/manifest/normalize-draft";

export type HarnessPipeline = "stub" | "full";

export interface GoldenPrompt {
  id: string;
  description: string;
  platform?: string;
  deployment?: string;
  additionalContext?: string;
}

/** Symmetric-judge outcome: the SAME ExecuteValidationReviewUseCase run over
 * each pipeline's final state. The stub never executes Stage 6 itself, so
 * judging both states with one judge is the only apples-to-apples quality
 * signal — never compare the full pipeline's own stage6 against nothing. */
export interface JudgeResult {
  passed: boolean;
  errorCount: number;
  warningCount: number;
  /** Rule IDs (R01–R18) extracted from tagged judge messages. */
  ruleIds: string[];
}

export interface StateMetrics {
  contextCount: number;
  portCount: number;
  adapterCount: number;
  /** stage5 YAML is non-empty AND parses to a non-null object. */
  yamlParses: boolean;
  yamlBytes: number;
  /** Accepted context names that violate the deterministic ban list. */
  bannedContextNames: string[];
  /** `context/adapter→implements` entries where the adapter's `implements`
   * does not name any port declared for that context in stage3. */
  unmatchedAdapterImplements: string[];
}

export interface RunRecord {
  promptId: string;
  pipeline: HarnessPipeline;
  success: boolean;
  durationMs: number;
  error?: string;
  metrics?: StateMetrics;
  judge?: JudgeResult;
}

export interface PipelineSummary {
  pipeline: HarnessPipeline;
  total: number;
  successCount: number;
  /** successCount / total; 0 when there are no runs. */
  successRate: number;
  /** Percentiles over SUCCESSFUL runs only — T2 asks "how long does a
   * delivered manifest take?"; failure cost (including slow timeouts) is
   * T1's signal and stays visible per-run in the report. 0 when there are
   * no successes. */
  p50DurationMs: number;
  p95DurationMs: number;
  judgedCount: number;
  judgePassCount: number;
  /** judgePassCount / judgedCount; 0 when nothing was judged. */
  judgePassRate: number;
  bannedNameCount: number;
  /** Successful runs that produced zero accepted contexts (gate T4). */
  zeroContextSuccesses: number;
}

export interface GateResult {
  id: "T1" | "T2" | "T3" | "T4";
  description: string;
  passed: boolean;
  detail: string;
}

/** Extract distinct R-rule IDs (R01–R18 vocabulary) from judge messages.
 * Token-boundary match so "R123" never yields "R12". */
export function extractRuleIds(messages: string[]): string[] {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const match of message.match(/\bR\d{2}\b/g) ?? []) {
      ids.add(match);
    }
  }
  return [...ids].sort();
}

export function judgeFromReport(report: ValidationReport): JudgeResult {
  return {
    passed: report.passed,
    errorCount: report.errors.length,
    warningCount: report.warnings.length,
    ruleIds: extractRuleIds([...report.errors, ...report.warnings]),
  };
}

export function computeStateMetrics(state: PipelineState): StateMetrics {
  const accepted = state.stage2?.accepted ?? [];
  const portCount =
    state.stage3?.contexts.reduce(
      (sum, c) => sum + c.in.length + c.out.length,
      0,
    ) ?? 0;
  const adapterCount =
    state.stage4?.contexts.reduce((sum, c) => sum + c.adapters.length, 0) ?? 0;

  const yamlText = state.stage5?.yaml ?? "";
  let yamlParses = false;
  if (yamlText.trim() !== "") {
    try {
      const parsed = yaml.load(yamlText);
      yamlParses = typeof parsed === "object" && parsed !== null;
    } catch {
      yamlParses = false;
    }
  }

  const bannedContextNames = accepted
    .map((ctx) => ctx.name)
    .filter((name) => isBannedContextName(name));

  // Adapter↔port integrity: each stage4 adapter's `implements` must name a
  // port declared for the same (normalized) context in stage3. Port names are
  // compared case-insensitively — stage drafts normalize casing late.
  const portsByContext = new Map<string, Set<string>>();
  for (const ctx of state.stage3?.contexts ?? []) {
    portsByContext.set(
      normalizeContextName(ctx.contextName),
      new Set([...ctx.in, ...ctx.out].map((port) => port.name.toLowerCase())),
    );
  }
  const unmatchedAdapterImplements: string[] = [];
  for (const ctx of state.stage4?.contexts ?? []) {
    const declared = portsByContext.get(normalizeContextName(ctx.contextName));
    for (const adapter of ctx.adapters) {
      if (!declared || !declared.has(adapter.implements.toLowerCase())) {
        unmatchedAdapterImplements.push(
          `${ctx.contextName}/${adapter.name}→${adapter.implements}`,
        );
      }
    }
  }

  return {
    contextCount: accepted.length,
    portCount,
    adapterCount,
    yamlParses,
    yamlBytes: Buffer.byteLength(yamlText, "utf8"),
    bannedContextNames,
    unmatchedAdapterImplements,
  };
}

/** Nearest-rank percentile (p in 0–100). Empty input → 0. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index] as number;
}

export function summarizeRuns(
  runs: RunRecord[],
  pipeline: HarnessPipeline,
): PipelineSummary {
  const own = runs.filter((run) => run.pipeline === pipeline);
  const successes = own.filter((run) => run.success);
  const judged = successes.filter((run) => run.judge !== undefined);
  const durations = successes.map((run) => run.durationMs);

  return {
    pipeline,
    total: own.length,
    successCount: successes.length,
    successRate: own.length === 0 ? 0 : successes.length / own.length,
    p50DurationMs: percentile(durations, 50),
    p95DurationMs: percentile(durations, 95),
    judgedCount: judged.length,
    judgePassCount: judged.filter((run) => run.judge?.passed).length,
    judgePassRate:
      judged.length === 0
        ? 0
        : judged.filter((run) => run.judge?.passed).length / judged.length,
    bannedNameCount: successes.reduce(
      (sum, run) => sum + (run.metrics?.bannedContextNames.length ?? 0),
      0,
    ),
    zeroContextSuccesses: successes.filter(
      (run) => run.metrics?.contextCount === 0,
    ).length,
  };
}

const pct = (rate: number): string => `${(rate * 100).toFixed(1)}%`;

/**
 * Quantitative rollback gates for the A3 canary
 * (docs/planning/normalizer-rewire-development-plan.md, A3):
 *
 * - T1 error rate:  full success-rate must not drop more than 10pp below stub.
 * - T2 latency:     full p95 must not exceed 2× stub p95.
 * - T3 quality:     full judge pass-rate must not regress vs stub, and full
 *                   output must contain ZERO banned context names.
 * - T4 empty output: no successful full run may produce 0 contexts.
 *
 * Any failed gate ⇒ flip `STAGED_GENERATION_PIPELINE=stub` (the one-flip
 * rollback lever) and investigate before resuming the canary.
 */
export function evaluateGates(
  stub: PipelineSummary,
  full: PipelineSummary,
): GateResult[] {
  if (full.total === 0) {
    return notEvaluable("no full-pipeline runs — gates not evaluable");
  }
  // A measured stub baseline is a precondition for every gate: with zero
  // stub runs (--pipelines=full) or zero stub successes (e.g. an invalid
  // API key erroring every run), T1's floor collapses to −10pp and T2/T3
  // compare against empty aggregates — all four gates would pass vacuously.
  if (stub.total === 0 || stub.successCount === 0) {
    return notEvaluable(
      `no stub baseline — gates not evaluable (stub runs: ${stub.total}, successes: ${stub.successCount})`,
    );
  }

  const t1Passed = full.successRate >= stub.successRate - 0.1;
  const t1: GateResult = {
    id: "T1",
    description: GATE_DESCRIPTIONS.T1,
    passed: t1Passed,
    detail: `full ${pct(full.successRate)} vs stub ${pct(stub.successRate)} (floor ${pct(Math.max(stub.successRate - 0.1, 0))})`,
  };

  // The stub-baseline guard above guarantees ≥1 stub success, so p95 can
  // only be 0 here if every stub success completed in <1ms — degenerate;
  // surface it in the detail rather than dividing judgement by it.
  const t2NotEvaluable = stub.p95DurationMs === 0;
  const t2: GateResult = {
    id: "T2",
    description: GATE_DESCRIPTIONS.T2,
    passed: t2NotEvaluable
      ? true
      : full.p95DurationMs <= 2 * stub.p95DurationMs,
    detail: t2NotEvaluable
      ? "stub p95 is 0ms — gate not evaluable, treated as pass"
      : `full p95 ${full.p95DurationMs}ms vs 2× stub p95 ${2 * stub.p95DurationMs}ms`,
  };

  // Judge evaluability: a pipeline with successes but ZERO judge verdicts
  // (judge provider erroring on every run) has judgePassRate 0/0 → 0, and
  // the rate comparison would pass vacuously (0 ≥ 0). No verdicts where
  // verdicts were due means the quality gate cannot certify anything.
  const judgeBrokenFor = [
    ...(stub.successCount > 0 && stub.judgedCount === 0 ? ["stub"] : []),
    ...(full.successCount > 0 && full.judgedCount === 0 ? ["full"] : []),
  ];
  const t3Passed =
    judgeBrokenFor.length === 0 &&
    full.judgePassRate >= stub.judgePassRate &&
    full.bannedNameCount === 0;
  const t3: GateResult = {
    id: "T3",
    description: GATE_DESCRIPTIONS.T3,
    passed: t3Passed,
    detail:
      judgeBrokenFor.length > 0
        ? `judge produced no verdicts for ${judgeBrokenFor.join(" and ")} successes — gate not evaluable`
        : `judge pass-rate full ${pct(full.judgePassRate)} vs stub ${pct(stub.judgePassRate)}; banned names in full output: ${full.bannedNameCount}`,
  };

  const t4: GateResult = {
    id: "T4",
    description: GATE_DESCRIPTIONS.T4,
    passed: full.zeroContextSuccesses === 0,
    detail: `zero-context successes in full pipeline: ${full.zeroContextSuccesses}`,
  };

  return [t1, t2, t3, t4];
}

/** All four gates fail with one shared detail when the run set cannot
 * support a verdict at all (missing pipeline or missing stub baseline). */
function notEvaluable(detail: string): GateResult[] {
  return (["T1", "T2", "T3", "T4"] as const).map((id) => ({
    id,
    description: GATE_DESCRIPTIONS[id],
    passed: false,
    detail,
  }));
}

const GATE_DESCRIPTIONS: Record<GateResult["id"], string> = {
  T1: "error rate — full success-rate ≥ stub − 10pp",
  T2: "latency — full p95 ≤ 2× stub p95",
  T3: "quality — judge pass-rate not regressed AND zero banned context names",
  T4: "empty output — no successful full run yields 0 contexts",
};

/** Free text destined for a markdown table cell (provider error messages,
 * model-produced names) may contain pipes or newlines that would break the
 * row structure — escape/flatten them. */
const mdCell = (text: string): string =>
  text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export function renderMarkdown(
  summaries: PipelineSummary[],
  gates: GateResult[],
  runs: RunRecord[],
): string {
  const lines: string[] = [];
  lines.push("# Golden-manifest harness report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");

  lines.push("## Rollback gates (A3)");
  lines.push("");
  lines.push("| Gate | Description | Verdict | Detail |");
  lines.push("| --- | --- | --- | --- |");
  for (const gate of gates) {
    lines.push(
      `| ${gate.id} | ${gate.description} | ${gate.passed ? "✅ pass" : "❌ FAIL"} | ${gate.detail} |`,
    );
  }
  lines.push("");

  lines.push("## Pipeline summaries");
  lines.push("");
  lines.push(
    "| Pipeline | Runs | Success | p50 | p95 | Judge pass | Banned names | Zero-context |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const s of summaries) {
    lines.push(
      `| ${s.pipeline} | ${s.total} | ${s.successCount} (${pct(s.successRate)}) | ${s.p50DurationMs}ms | ${s.p95DurationMs}ms | ${s.judgePassCount}/${s.judgedCount} (${pct(s.judgePassRate)}) | ${s.bannedNameCount} | ${s.zeroContextSuccesses} |`,
    );
  }
  lines.push("");

  lines.push("## Runs");
  lines.push("");
  lines.push(
    "| Prompt | Pipeline | Outcome | Duration | Contexts | Ports | Adapters | YAML | Judge | Rules | Notes |",
  );
  lines.push(
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const run of runs) {
    const m = run.metrics;
    const judge = run.judge
      ? `${run.judge.passed ? "pass" : "fail"} (${run.judge.errorCount}E/${run.judge.warningCount}W)`
      : "—";
    const notes = [
      ...(m?.bannedContextNames.length
        ? [`banned: ${m.bannedContextNames.join(", ")}`]
        : []),
      ...(m?.unmatchedAdapterImplements.length
        ? [`unmatched adapters: ${m.unmatchedAdapterImplements.length}`]
        : []),
      ...(run.error ? [run.error] : []),
    ].join("; ");
    lines.push(
      `| ${run.promptId} | ${run.pipeline} | ${run.success ? "ok" : "ERROR"} | ${run.durationMs}ms | ${m?.contextCount ?? "—"} | ${m?.portCount ?? "—"} | ${m?.adapterCount ?? "—"} | ${m ? (m.yamlParses ? "parses" : "INVALID") : "—"} | ${judge} | ${run.judge?.ruleIds.join(" ") || "—"} | ${mdCell(notes)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
