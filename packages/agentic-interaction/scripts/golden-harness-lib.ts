/**
 * Pure helpers for the golden-manifest harness.
 *
 * The harness runs the golden prompts through the full 0→6 staged-generation
 * pipeline (the only pipeline since A4 deleted the 4-pass stub), judges each
 * result with the Stage-6 validation review, and evaluates absolute quality
 * gates G1–G4. The stub-relative A3 canary gates (full-vs-stub success,
 * latency and judge comparisons) retired with the stub — every gate here is
 * an absolute bound on the full pipeline's own output.
 *
 * Everything in this module is deterministic and side-effect free so it can
 * be unit-tested without an LLM; the runner (golden-manifest-harness.ts) owns
 * I/O and provider wiring.
 */

import yaml from "js-yaml";
import type {
  PipelineState,
  ValidationReport,
} from "../src/domain/value-objects/pipeline-state";
import { isBannedContextName } from "../src/domain/prompts/architecture-contract";
import { normalizeContextName } from "../src/domain/manifest/normalize-draft";

export interface GoldenPrompt {
  id: string;
  description: string;
  platform?: string;
  deployment?: string;
  additionalContext?: string;
}

/** Stage-6 review outcome over a run's final state. The review is the only
 * absolute quality signal the harness has, so G2 requires it to have
 * certified every successful run. */
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
  success: boolean;
  durationMs: number;
  error?: string;
  metrics?: StateMetrics;
  judge?: JudgeResult;
}

export interface HarnessSummary {
  total: number;
  successCount: number;
  /** successCount / total; 0 when there are no runs. */
  successRate: number;
  /** Percentiles over SUCCESSFUL runs only — G1 asks "how long does a
   * delivered manifest take?"; failure cost (including slow timeouts) stays
   * visible per-run in the report. 0 when there are no successes. */
  p50DurationMs: number;
  p95DurationMs: number;
  judgedCount: number;
  judgePassCount: number;
  /** judgePassCount / judgedCount; 0 when nothing was judged. */
  judgePassRate: number;
  bannedNameCount: number;
  /** Successful runs that produced zero accepted contexts (gate G4). */
  zeroContextSuccesses: number;
}

export interface GateResult {
  id: "G1" | "G2" | "G3" | "G4";
  description: string;
  passed: boolean;
  detail: string;
}

/** Extract distinct R-rule IDs (live vocabulary: R01–R18) from judge messages.
 * Token-boundary match so "R123" never yields "R12". Deliberately NOT
 * range-constrained to 01–18: the vocabulary is owned by the validators (new
 * rules must surface here without a harness edit), and judge messages are
 * partly LLM-authored — an out-of-vocabulary ID in the report is judge-
 * misbehavior signal worth seeing, not noise to drop. Report-only; feeds no
 * gate. */
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

export function summarize(runs: RunRecord[]): HarnessSummary {
  const successes = runs.filter((run) => run.success);
  const judged = successes.filter((run) => run.judge !== undefined);
  const durations = successes.map((run) => run.durationMs);
  const judgePassCount = judged.filter((run) => run.judge?.passed).length;

  return {
    total: runs.length,
    successCount: successes.length,
    successRate: runs.length === 0 ? 0 : successes.length / runs.length,
    p50DurationMs: percentile(durations, 50),
    p95DurationMs: percentile(durations, 95),
    judgedCount: judged.length,
    judgePassCount,
    judgePassRate: judged.length === 0 ? 0 : judgePassCount / judged.length,
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
 * G1 latency ceiling (recalibrated 2026-06-10 after the five-model sweep,
 * carried over from the retired A3 T2 gate): a full pipeline at user-facing
 * latency under ~45s is acceptable. The ceiling is anchored just above the
 * post-#292 gpt-4o full p95 (42.9s). With the stub gone the gate is now a
 * pure absolute bound — the old `max(2× stub p95, ceiling)` hybrid had no
 * baseline to compare against once the stub was deleted.
 */
export const LATENCY_CEILING_MS = 45_000;

const GATE_DESCRIPTIONS: Record<GateResult["id"], string> = {
  G1: `latency — p95 ≤ ${LATENCY_CEILING_MS / 1000}s`,
  G2: "quality — every successful run judged AND all pass Stage-6 review",
  G3: "naming — zero banned context names in output",
  G4: "empty output — no successful run yields 0 contexts",
};

/**
 * Absolute quality gates for the full pipeline. Any failed gate is a
 * regression worth investigating before the next release.
 *
 * - G1 latency:  p95 of successful runs ≤ LATENCY_CEILING_MS.
 * - G2 quality:  every successful run was judged (no judge-provider gaps) AND
 *                all judged runs pass the Stage-6 review.
 * - G3 naming:   zero banned context names across successful runs.
 * - G4 empty:    no successful run yields 0 accepted contexts.
 *
 * Preconditions (fail every gate, never pass vacuously): at least one run,
 * and at least one SUCCESSFUL run — a run set with no successes (e.g. an
 * invalid API key erroring every call) cannot certify anything.
 */
export function evaluateGates(full: HarnessSummary): GateResult[] {
  if (full.total === 0) {
    return notEvaluable("no pipeline runs — gates not evaluable");
  }
  if (full.successCount === 0) {
    return notEvaluable(
      `no successful runs to certify — gates not evaluable (runs: ${full.total})`,
    );
  }

  const g1: GateResult = {
    id: "G1",
    description: GATE_DESCRIPTIONS.G1,
    passed: full.p95DurationMs <= LATENCY_CEILING_MS,
    detail: `p95 ${full.p95DurationMs}ms vs ceiling ${LATENCY_CEILING_MS}ms`,
  };

  // The judge must have certified EVERY success: a success whose judge errored
  // (judgedCount < successCount) leaves an uncertified manifest, so the quality
  // gate cannot pass on partial coverage — it fails as not-evaluable rather
  // than passing vacuously on the runs that happened to be judged.
  const judgeComplete = full.judgedCount === full.successCount;
  const g2: GateResult = {
    id: "G2",
    description: GATE_DESCRIPTIONS.G2,
    passed: judgeComplete && full.judgePassRate === 1,
    detail: judgeComplete
      ? `judge pass-rate ${pct(full.judgePassRate)} (${full.judgePassCount}/${full.judgedCount})`
      : `judge certified only ${full.judgedCount}/${full.successCount} successes — gate not evaluable`,
  };

  const g3: GateResult = {
    id: "G3",
    description: GATE_DESCRIPTIONS.G3,
    passed: full.bannedNameCount === 0,
    detail: `banned context names in output: ${full.bannedNameCount}`,
  };

  const g4: GateResult = {
    id: "G4",
    description: GATE_DESCRIPTIONS.G4,
    passed: full.zeroContextSuccesses === 0,
    detail: `zero-context successes: ${full.zeroContextSuccesses}`,
  };

  return [g1, g2, g3, g4];
}

/** All gates fail with one shared detail when the run set cannot support a
 * verdict at all (no runs, or no successful runs). */
function notEvaluable(detail: string): GateResult[] {
  return (["G1", "G2", "G3", "G4"] as const).map((id) => ({
    id,
    description: GATE_DESCRIPTIONS[id],
    passed: false,
    detail,
  }));
}

/** Free text destined for a markdown table cell (provider error messages,
 * model-produced names) may contain pipes or newlines that would break the
 * row structure — escape/flatten them. */
const mdCell = (text: string): string =>
  text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

export function renderMarkdown(
  summary: HarnessSummary,
  gates: GateResult[],
  runs: RunRecord[],
  /** Injected by the runner (which owns the clock) so this module stays
   * deterministic — same inputs, same report. */
  generatedAtIso: string,
): string {
  const lines: string[] = [];
  lines.push("# Golden-manifest harness report");
  lines.push("");
  lines.push(`Generated: ${generatedAtIso}`);
  lines.push("");

  lines.push("## Quality gates (full pipeline)");
  lines.push("");
  lines.push("| Gate | Description | Verdict | Detail |");
  lines.push("| --- | --- | --- | --- |");
  for (const gate of gates) {
    lines.push(
      `| ${gate.id} | ${gate.description} | ${gate.passed ? "✅ pass" : "❌ FAIL"} | ${gate.detail} |`,
    );
  }
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(
    "| Runs | Success | p50 | p95 | Judge pass | Banned names | Zero-context |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  lines.push(
    `| ${summary.total} | ${summary.successCount} (${pct(summary.successRate)}) | ${summary.p50DurationMs}ms | ${summary.p95DurationMs}ms | ${summary.judgePassCount}/${summary.judgedCount} (${pct(summary.judgePassRate)}) | ${summary.bannedNameCount} | ${summary.zeroContextSuccesses} |`,
  );
  lines.push("");

  lines.push("## Runs");
  lines.push("");
  lines.push(
    "| Prompt | Outcome | Duration | Contexts | Ports | Adapters | YAML | Judge | Rules | Notes |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
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
      `| ${run.promptId} | ${run.success ? "ok" : "ERROR"} | ${run.durationMs}ms | ${m?.contextCount ?? "—"} | ${m?.portCount ?? "—"} | ${m?.adapterCount ?? "—"} | ${m ? (m.yamlParses ? "parses" : "INVALID") : "—"} | ${judge} | ${run.judge?.ruleIds.join(" ") || "—"} | ${mdCell(notes)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
