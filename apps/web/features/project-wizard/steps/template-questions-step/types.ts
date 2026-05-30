/**
 * Shape of a template question as recorded in a manifest. Subset of
 * @hexagen/template-engine's TemplateQuestion union — the wizard only needs
 * fields it renders. Keeping this local avoids importing the engine type
 * (which would drag node-only types into the apps/web bundle).
 */
export type TemplateQuestion =
  | {
      id: string;
      type: "text";
      prompt: string;
      default?: string;
      required?: boolean;
      validation?: { pattern: string; message: string };
    }
  | { id: string; type: "boolean"; prompt: string; default?: boolean }
  | {
      id: string;
      type: "select";
      prompt: string;
      options: string[];
      default?: string;
    }
  | {
      id: string;
      type: "multiselect";
      prompt: string;
      options: string[];
      default?: string[];
    }
  | {
      id: string;
      type: "auto";
      derivedFrom: string;
      default?: string | boolean | string[];
    };

/** A primitive answer value for a single question. */
export type AnswerValue = string | boolean | string[];

/** Per-template answer map: question-id → answer value. */
export type TemplateAnswers = Record<string, AnswerValue>;
