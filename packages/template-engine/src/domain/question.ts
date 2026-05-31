export type QuestionType =
  | "select"
  | "multiselect"
  | "text"
  | "boolean"
  | "auto";

export interface SelectQuestion {
  id: string;
  type: "select";
  prompt: string;
  options: string[];
  default?: string;
}

export interface MultiSelectQuestion {
  id: string;
  type: "multiselect";
  prompt: string;
  options: string[];
  default?: string[];
}

export interface TextQuestion {
  id: string;
  type: "text";
  prompt: string;
  default?: string;
  validation?: { pattern: string; message: string };
  required?: boolean;
}

export interface BooleanQuestion {
  id: string;
  type: "boolean";
  prompt: string;
  default?: boolean;
}

export interface AutoQuestion {
  id: string;
  type: "auto";
  /** Template ID and question ID to copy the answer from, e.g. "rate-limiting.framework" */
  derivedFrom: string;
  default?: QuestionAnswer;
}

export type TemplateQuestion =
  | SelectQuestion
  | MultiSelectQuestion
  | TextQuestion
  | BooleanQuestion
  | AutoQuestion;

export type QuestionAnswer = string | string[] | boolean;

export type AnswerMap = Record<string, QuestionAnswer>;

export interface OutputCondition {
  /** Question id whose answer this output is gated on. */
  answer: string;
  /** Exact match for a boolean or select answer. */
  equals?: string | boolean;
  /** Require this value to be present in a multiselect answer. */
  includes?: string;
  /**
   * Match when a scalar (select/text) answer is one of these values — i.e. the
   * "answer is one of N" gate, so an output need not be duplicated once per
   * value. Mutually exclusive with `equals` / `includes`.
   */
  in?: string[];
}

/**
 * A manifest output entry: a plain relative path (always emitted) or a path
 * gated on an answer via a `when` condition.
 */
export type ManifestOutput = string | { path: string; when: OutputCondition };
