/**
 * Pure validators for Jev decision answers (lane J1a). No npm imports.
 *
 * Every rejection maps to the closed-set `unknown` reasons `shape` or `tie`
 * (invariant 4: an unknown shape or a tie means "no advice").
 */

import type { ChoiceAnswer, NoulAnswer } from "./decision-advice.types";

export type AnswerParseResult<A> =
  | { ok: true; answer: A }
  | { ok: false; reason: "shape" | "tie" };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Validate a raw `choice` answer against the question's option ids.
 *
 * Rejects as `unknown/shape`: unknown keys in `probabilities`, a missing
 * option, a non-finite number or a number outside 0..1, a `choice` that is not
 * the single argmax. A tie for the maximum is `unknown/tie`.
 */
export function parseChoiceAnswer(
  raw: unknown,
  optionIds: readonly string[],
): AnswerParseResult<ChoiceAnswer> {
  if (!isPlainObject(raw)) return { ok: false, reason: "shape" };
  if (raw["type"] !== "choice") return { ok: false, reason: "shape" };
  if (typeof raw["choice"] !== "string") return { ok: false, reason: "shape" };
  if (!isPlainObject(raw["probabilities"])) return { ok: false, reason: "shape" };
  if (!isProbability(raw["confidence"])) return { ok: false, reason: "shape" };

  const probabilities = raw["probabilities"];
  const expected = new Set(optionIds);

  // Unknown keys and missing options both reject: the distribution must cover
  // exactly the question's option ids.
  for (const key of Object.keys(probabilities)) {
    if (!expected.has(key)) return { ok: false, reason: "shape" };
  }
  for (const id of optionIds) {
    if (!(id in probabilities)) return { ok: false, reason: "shape" };
    const p: unknown = probabilities[id];
    if (!isProbability(p)) return { ok: false, reason: "shape" };
  }

  const choice = raw["choice"];
  if (!expected.has(choice)) return { ok: false, reason: "shape" };

  // The choice must be the single argmax; a tie is its own unknown reason.
  const values: number[] = optionIds.map((id) => probabilities[id] as number);
  let max = -1;
  let argmaxCount = 0;
  for (const p of values) {
    if (p > max) {
      max = p;
      argmaxCount = 1;
    } else if (p === max) {
      argmaxCount += 1;
    }
  }
  if (argmaxCount > 1) return { ok: false, reason: "tie" };
  if ((probabilities[choice] as number) !== max) return { ok: false, reason: "shape" };

  return {
    ok: true,
    answer: {
      type: "choice",
      choice,
      // Copy under the closed key set so no extra property can ride along.
      probabilities: Object.fromEntries(
        optionIds.map((id) => [id, probabilities[id] as number]),
      ),
      confidence: raw["confidence"],
    },
  };
}

/**
 * Validate a raw `noul` answer. Returns a probability whose confidence is
 * `max(p, 1−p)`.
 */
export function parseNoulAnswer(raw: unknown): AnswerParseResult<NoulAnswer> {
  if (!isPlainObject(raw)) return { ok: false, reason: "shape" };
  if (raw["type"] !== "noul") return { ok: false, reason: "shape" };
  if (!isProbability(raw["probability"])) return { ok: false, reason: "shape" };

  const probability = raw["probability"];
  return {
    ok: true,
    answer: {
      type: "noul",
      probability,
      confidence: Math.max(probability, 1 - probability),
    },
  };
}