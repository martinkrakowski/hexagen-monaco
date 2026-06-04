import type { AddOnAnswers } from "@hexagen/project-generation";

/** Structural guard for the wizard's untrusted `addOnsAnswers` payload. */
export const isAddOnAnswers = (value: unknown): value is AddOnAnswers =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every(
    (answers) =>
      typeof answers === "object" &&
      answers !== null &&
      !Array.isArray(answers) &&
      Object.values(answers).every(
        (v) =>
          typeof v === "string" ||
          typeof v === "boolean" ||
          (Array.isArray(v) && v.every((item) => typeof item === "string")),
      ),
  );

/**
 * Pull `addOnsAnswers` off an untrusted `wizardData` payload and validate its
 * shape. Returns the validated map, `{}` when absent, or `null` when present
 * but malformed (the caller should respond 400).
 *
 * Shared by `/api/generate` and the `/api/export/*` routes so add-on threading
 * and validation stay identical across every generation/export entry point.
 */
export function readAddOnAnswers(
  wizardData: Record<string, unknown> | undefined,
): AddOnAnswers | null {
  const raw = wizardData?.addOnsAnswers;
  if (raw === undefined) return {};
  return isAddOnAnswers(raw) ? raw : null;
}
