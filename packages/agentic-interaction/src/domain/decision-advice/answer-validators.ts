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
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
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
  if (!isChoiceEnvelope(raw)) return SHAPE;
  const { choice, probabilities, confidence } = raw;
  if (!coversExactly(probabilities, optionIds)) return SHAPE;
  if (!optionIds.includes(choice)) return SHAPE;

  // The choice must be the single argmax; a tie is its own unknown reason.
  const values = optionIds.map((id) => probabilities[id] as number);
  const max = Math.max(...values);
  if (values.filter((p) => p === max).length > 1)
    return { ok: false, reason: "tie" };
  if (probabilities[choice] !== max) return SHAPE;

  return {
    ok: true,
    answer: {
      type: "choice",
      choice,
      // Copy under the closed key set so no extra property can ride along.
      probabilities: Object.fromEntries(
        optionIds.map((id) => [id, probabilities[id] as number]),
      ),
      confidence,
    },
  };
}

const SHAPE = { ok: false, reason: "shape" } as const;

type ChoiceEnvelope = {
  type: "choice";
  choice: string;
  probabilities: Record<string, unknown>;
  confidence: number;
};

function isChoiceEnvelope(raw: unknown): raw is ChoiceEnvelope {
  return (
    isPlainObject(raw) &&
    raw["type"] === "choice" &&
    typeof raw["choice"] === "string" &&
    isPlainObject(raw["probabilities"]) &&
    isProbability(raw["confidence"])
  );
}

/** Unknown keys and missing options both fail: the distribution covers exactly the option ids. */
function coversExactly(
  probabilities: Record<string, unknown>,
  optionIds: readonly string[],
): boolean {
  const keys = Object.keys(probabilities);
  return (
    keys.length === optionIds.length &&
    keys.every((key) => optionIds.includes(key)) &&
    optionIds.every((id) => isProbability(probabilities[id]))
  );
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
