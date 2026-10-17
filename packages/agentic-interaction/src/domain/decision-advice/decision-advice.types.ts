/**
 * Jev decision-advice domain value objects (lane J1a).
 *
 * Pure types only — no npm imports (ADR-0054). These describe the wire shape of
 * a Jev decision request/response as recorded in the committed fixtures under
 * `__tests__/use-cases/staged-generation/fixtures/jev/`.
 */

/** A `choice` question: pick one option id, scored against its criteria. */
export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  /** Option id → one-line description. */
  criteria: Record<string, string>;
}

/** A `noul` question: estimate a probability for a yes/no judgement. */
export interface NoulQuestion {
  type: "noul";
  instructions: string;
}

export type DecisionQuestion = ChoiceQuestion | NoulQuestion;

/** Question id → question. Ids are caller-minted (`c0…cn`, `q0…`). */
export type DecisionQuestions = Record<string, DecisionQuestion>;

/** A `choice` answer: the argmax option, its full distribution and a confidence. */
export interface ChoiceAnswer {
  type: "choice";
  /** The single argmax option id; a tie is rejected by the validator. */
  choice: string;
  /** Probability per option id; keys must match the question's option ids exactly. */
  probabilities: Record<string, number>;
  /** 0..1. */
  confidence: number;
}

/** A `noul` answer: one probability; the confidence is derived as `max(p, 1−p)`. */
export interface NoulAnswer {
  type: "noul";
  /** 0..1. */
  probability: number;
  /** 0..1, always `max(probability, 1 − probability)`. */
  confidence: number;
}

export type DecisionAnswer = ChoiceAnswer | NoulAnswer;

/** One declared field sent as state. Name and value are caller-supplied text. */
export interface DecisionAdviceField {
  name: string;
  value: string;
}

/**
 * The port's request. Only declared fields are ever sent (invariant 3:
 * declared fields only; refuse, never redact).
 */
export interface DecisionAdviceRequest {
  /** Closed-set use identifier (e.g. `context-type`, `template-select`). */
  use: string;
  fields: DecisionAdviceField[];
  questions: DecisionQuestions;
}

/** Closed-set `unknown` reasons. Any failure means "no advice" (invariant 4). */
export type DecisionUnknownReason =
  | "disabled"
  | "refused"
  | "budget"
  | "timeout"
  | "http"
  | "shape"
  | "tie"
  | "error";

/**
 * Closed-set, numeric-or-identifier receipt carried on every result so a
 * receipt store (J1c) can persist one row per call without ever seeing state
 * text, project text or the key (invariant 5).
 */
export interface DecisionReceipt {
  /** Closed-set use identifier, mirrors `DecisionAdviceRequest.use`. */
  use: string;
  /** Model identifier as reported by the provider, or `""` when no call was made. */
  model: string;
  /** Provider call id, or `""` when no call was made. */
  requestId: string;
  /** Caller-minted generation id, or `""` when not supplied. */
  generationId: string;
  /** `advised` or the `unknown` reason; `""` when advised. */
  status: "advised" | DecisionUnknownReason;
  /** Call cost in micro-USD, or `null` when unknown. */
  costMicroUsd: number | null;
  /** Call latency in milliseconds, or `null` when unknown. */
  latencyMs: number | null;
}

/** The result union: advice, or an `unknown` reason meaning "today's result stands". */
export type DecisionAdviceResult =
  | {
      status: "advised";
      /** Question id → validated answer. */
      answers: Record<string, DecisionAnswer>;
      receipt: DecisionReceipt;
    }
  | {
      status: "unknown";
      reason: DecisionUnknownReason;
      receipt?: DecisionReceipt;
    };

/** U-A's mode (`JEV_CONTEXT_TYPE_MODE`): `off` is the default. */
export type ContextTypeAdviceMode = "off" | "shadow" | "primary";

/** Where today's (pre-advice) answer for one reviewed context came from. */
export type ContextTypeTodaySource = "llm" | "heuristic";

/**
 * One reviewed context's answer row. Closed values only: the answers are the
 * five context-type ids, never a context name or free text (invariant 5) —
 * a receipt store can persist one row per answer without seeing state.
 */
export interface ContextTypeAnswerRecord {
  /** Index into the request's `c0…cn` keys. */
  questionIndex: number;
  /** Jev's choice, one of the five context-type ids. */
  jevAnswer: string;
  /** 0..1. */
  jevConfidence: number;
  /** Today's type, one of the five context-type ids. */
  todayAnswer: string;
  /** `"llm"` when the classifier succeeded for this context, else `"heuristic"`. */
  todaySource: ContextTypeTodaySource;
  /** `jevAnswer === todayAnswer`. */
  agreement: boolean;
}

/**
 * One U-A advice call's receipt (lane J2). Emitted through the injected
 * `receiptSink` once per advice call, per generation, beside the
 * {@link DecisionReceipt} the store persists.
 */
export interface ContextTypeReceipt {
  /** Caller-minted generation id, minted once per `execute()` run. */
  generationId: string;
  /** The active mode at call time. */
  mode: ContextTypeAdviceMode;
  /** The port's own closed-set receipt. */
  receipt: DecisionReceipt;
  /** One row per reviewed context with a choice answer. */
  answers: ContextTypeAnswerRecord[];
}
