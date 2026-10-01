import { z } from "zod";
import { FilePathString, SchemaVersion, SlicePathString } from "./common.js";

/**
 * Built-in rule id: an unresolved in-slice import specifier is a violation of
 * this rule. `knownViolations[].rule` may cite it; `rules[].id` may not use it.
 */
export const UNRESOLVED_IMPORT_RULE_ID = "unresolved-import";
export const BUILTIN_RULE_IDS: readonly string[] = [UNRESOLVED_IMPORT_RULE_ID];

const Rule = z
  .object({
    id: z
      .string()
      .min(1)
      .refine((id) => !BUILTIN_RULE_IDS.includes(id), {
        message: "rule id is reserved for a built-in rule",
      }),
    kind: z.enum(["forbid", "allow-only"]),
    from: SlicePathString,
    to: SlicePathString,
    severity: z.enum(["error", "warn"]),
  })
  .strict();

/**
 * Entry shape of the ratchet baseline (`tools/arch-linter/src/ratchet-baseline.ts`
 * `BaselineEntry`): `rule`, `file` and `specifier`, with the optional `reason`
 * and `expires` kept.
 */
const KnownViolation = z
  .object({
    rule: z.string().min(1),
    file: FilePathString,
    specifier: z.string(),
    reason: z.string().min(1).optional(),
    expires: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .strict();

/** `.hexagen/contract.json`: what the slice may and may not depend on. */
export const Contract = z
  .object({
    schemaVersion: SchemaVersion,
    sliceId: z.string().min(1),
    rules: z.array(Rule),
    knownViolations: z.array(KnownViolation),
  })
  .strict();

export type Contract = z.infer<typeof Contract>;
