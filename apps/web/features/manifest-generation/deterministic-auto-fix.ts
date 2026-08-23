import {
  parseYamlToViewData,
  canAutoFix,
  applyDeterministicFix,
} from "@hexagen/manifest-generation";
import type { ValidationItem } from "@hexagen/manifest-generation";

/**
 * The browser half of the repair loop, lifted verbatim out of
 * `ManifestPreview.tsx` so that what it *observes* can be tested without a DOM.
 *
 * ## What the loop actually does (it is a fixpoint, not a single pass)
 *
 * The shape in `ManifestPreview` was easy to misread as "stops after the first
 * fix". It does not. On the first fix it `break`s out of the item loop and the
 * enclosing `while` re-parses the UPDATED document and starts a fresh pass from
 * the top; it stops when a WHOLE pass applies nothing. So later violations are
 * re-evaluated — just on the next round, against the new YAML, which is the
 * only correct thing to do (a fix invalidates every item computed from the
 * pre-fix document).
 *
 * That control flow is reproduced here EXACTLY: same predicate order, same
 * `applyDeterministicFix` calls, same `break`, same termination condition. The
 * only thing added is bookkeeping. Nothing about WHICH violations get fixed, or
 * what the fixes produce, changes — which is a hard requirement of
 * `docs/planning/2026-08-22-repair-telemetry-plan.md`: P0 explicitly forbids
 * new deterministic rules because they would move the very behaviour the
 * repair baseline is meant to measure.
 *
 * ## What WAS missing: the fall-through set
 *
 * ADR-0067 targets "everything `canAutoFix` returns false for" — plus, in
 * practice, everything it returns *true* for whose rule then declines to touch
 * the document (`applyDeterministicFix` returning `null` or the input
 * unchanged; the parser's own comment on first-match-wins port matching calls
 * that class "permanently unfixable"). Neither set was recorded anywhere: the
 * loop kept only the titles of fixes it APPLIED.
 *
 * {@link DeterministicAutoFixOutcome.fellThrough} is that set, and it is
 * collected from the SETTLED document — the final, no-change pass, which is the
 * only pass that visits every item. Records from earlier passes are discarded
 * on purpose: a pass that stopped at its first fix saw a document that no
 * longer exists, and reporting its leftovers would overstate the residue.
 *
 * ## Why it is returned rather than sent anywhere
 *
 * Violation titles interpolate user data (`` `${name}: 3 Unconnected Ports` ``).
 * Until P0's stable `ViolationCode` union exists, persisting or transmitting
 * them would break the retention promise ADR-0067 records in four places. So
 * this module computes the set honestly and hands it back; P2 is where it gets
 * wired, once there is a bounded code to key on.
 */

/** Why a non-passing violation survived a settled auto-fix run. */
export type AutoFixFallThroughReason =
  /** `canAutoFix` said no — the allow-list does not cover this class at all. */
  | "not-allow-listed"
  /** Allow-listed, but the rule declined to change the document. */
  | "fix-made-no-change";

export interface AutoFixFallThrough {
  readonly violation: ValidationItem;
  readonly reason: AutoFixFallThroughReason;
}

export interface DeterministicAutoFixOutcome {
  /** The settled YAML. Identical to the input when nothing was applied. */
  readonly yaml: string;
  /**
   * Titles of the fixes applied, in application order, WITH duplicates — the
   * fixpoint can apply one class more than once and the round count is part of
   * what the baseline needs. Callers that display this dedupe it themselves,
   * exactly as `ManifestPreview` always has.
   */
  readonly appliedTitles: readonly string[];
  /** Non-passing violations still standing on the settled document. */
  readonly fellThrough: readonly AutoFixFallThrough[];
  /**
   * Passes made over the document, including the terminal no-change pass. A
   * document that needed no repair settles in 1.
   */
  readonly rounds: number;
}

/**
 * Run the deterministic fixer to a fixpoint and report what it could not do.
 *
 * Pure: `parseYamlToViewData`, `canAutoFix` and `applyDeterministicFix` are all
 * pure, so this performs no I/O and can be called from a render-time effect as
 * it always was.
 *
 * There is deliberately NO round cap. Adding one would change behaviour on any
 * document where the current loop runs long, and this change is not allowed to
 * change behaviour. If the baseline shows the loop running away, capping it is
 * a separate, visible decision.
 */
export function runDeterministicAutoFix(
  startingYaml: string,
): DeterministicAutoFixOutcome {
  let yaml = startingYaml;
  const appliedTitles: string[] = [];
  let fellThrough: AutoFixFallThrough[] = [];
  let rounds = 0;
  let changed = true;

  while (changed) {
    changed = false;
    rounds += 1;
    const survivors: AutoFixFallThrough[] = [];
    const viewData = parseYamlToViewData(yaml);

    for (const violation of viewData.validationItems) {
      if (violation.status === "pass") continue;
      if (!canAutoFix(violation)) {
        survivors.push({ violation, reason: "not-allow-listed" });
        continue;
      }
      const patched = applyDeterministicFix(yaml, violation);
      if (patched && patched !== yaml) {
        yaml = patched;
        appliedTitles.push(violation.title);
        changed = true;
        break;
      }
      survivors.push({ violation, reason: "fix-made-no-change" });
    }

    // Only the terminal pass walked every item against the document that
    // actually survives, so only its record is kept.
    if (!changed) fellThrough = survivors;
  }

  return { yaml, appliedTitles, fellThrough, rounds };
}
