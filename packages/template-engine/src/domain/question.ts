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
