import { testNames } from "./handoff.js";
import type {
  BindingResult,
  Handoff,
  HandoffDeps,
  HandoffReport,
} from "./types.js";

export const EXIT_READY = 0;
export const EXIT_NOT_READY = 1;

/**
 * Decides whether a stage-1 handoff is ready for stage 2.
 *
 * Two conditions, and both have been violated in practice:
 *
 * 1. **Every rule has a test.** A stage-1 author that misses a rule caps the
 *    implementation at its own completeness, and coverage cannot see the gap.
 * 2. **Every one of those tests is red.** A test that already passes pins
 *    nothing; stage 2 would satisfy it by changing nothing.
 */
export async function checkHandoff(
  handoff: Handoff,
  deps: HandoffDeps,
): Promise<HandoffReport> {
  const declared = new Set<string>();
  for (const file of handoff.files) {
    for (const name of testNames(await deps.readFile(file))) declared.add(name);
  }
  const failing = new Set(await deps.failingTests(handoff.files));

  const bindings: BindingResult[] = handoff.rules.map((rule) => ({
    rule,
    status: !declared.has(rule.test)
      ? "missing"
      : failing.has(rule.test)
        ? "red"
        : "passing",
  }));

  const claimed = new Set(handoff.rules.map((r) => r.test));
  const unclaimed = [...declared].filter((name) => !claimed.has(name));

  return { lane: handoff.lane, bindings, unclaimed };
}

export function formatReport(report: HandoffReport): string {
  const lines: string[] = [];
  for (const { rule, status } of report.bindings) {
    if (status === "missing") {
      lines.push(
        `NO TEST   ${rule.id}`,
        `  rule: ${rule.statement}`,
        `  names: ${rule.test}`,
        `  No test by that name exists. Stage 2 would implement the tests it was`,
        `  given and leave this rule out, and coverage would not show the gap.`,
      );
    } else if (status === "passing") {
      lines.push(
        `NOT RED   ${rule.id}`,
        `  rule: ${rule.statement}`,
        `  names: ${rule.test}`,
        `  That test already passes, so it pins nothing: stage 2 could satisfy it`,
        `  by changing nothing at all.`,
      );
    }
  }
  if (report.unclaimed.length > 0) {
    lines.push(
      `Unclaimed tests (no rule names them) — not fatal, but worth a look:`,
      ...report.unclaimed.map((n) => `  - ${n}`),
    );
  }
  const bad = report.bindings.filter((b) => b.status !== "red").length;
  lines.push(
    bad === 0
      ? `${report.lane}: ${report.bindings.length} rule(s), each bound to a failing test. Ready for stage 2.`
      : `${report.lane}: ${bad} of ${report.bindings.length} rule(s) not ready.`,
  );
  return lines.join("\n");
}

export function exitCodeFor(report: HandoffReport): number {
  return report.bindings.every((b) => b.status === "red")
    ? EXIT_READY
    : EXIT_NOT_READY;
}
