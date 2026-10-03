import { z } from "zod";
import { FilePathString, SchemaVersion, SlicePathString } from "./common.js";

/**
 * Built-in rule id: an unresolved in-slice import specifier is a violation of
 * this rule. `knownViolations[].rule` may cite it; `rules[].id` may not use it.
 */
export const UNRESOLVED_IMPORT_RULE_ID = "unresolved-import";
export const BUILTIN_RULE_IDS: readonly string[] = [UNRESOLVED_IMPORT_RULE_ID];

const RuleId = z
  .string()
  .min(1)
  .refine((id) => !BUILTIN_RULE_IDS.includes(id), {
    message: "rule id is reserved for a built-in rule",
  });

const RuleSeverity = z.enum(["error", "warn"]);

/**
 * `forbid` and `allow-only` are prefix pairs: `from` and `to` are both
 * required, and a rule of these kinds may not carry an `except` list.
 */
const PrefixRule = z
  .object({
    id: RuleId,
    kind: z.enum(["forbid", "allow-only"]),
    from: SlicePathString,
    to: SlicePathString,
    severity: RuleSeverity,
  })
  .strict();

/**
 * `closed` is the slice as the `from` side, so it carries no `from`/`to`: every
 * edge that leaves the slice is denied unless its target is inside the slice or
 * under an `except` prefix. The list is required (an empty one accepts no
 * crossing) and may be empty.
 */
const ClosedRule = z
  .object({
    id: RuleId,
    kind: z.literal("closed"),
    except: z.array(SlicePathString),
    severity: RuleSeverity,
  })
  .strict();

/**
 * A discriminated union on `kind`, so the shape of a rule is decided by its
 * kind: `from`/`to` are refused on `closed`, `except` on the other two, and each
 * invalid rule reports the field that was wrong instead of a generic failure.
 */
const Rule = z.discriminatedUnion("kind", [PrefixRule, ClosedRule]);

/** True for a YYYY-MM-DD string that names a real calendar day (2026-02-30 is not one). */
function isRealCalendarDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = new Date(Date.UTC(y, mo - 1, d));
  return (
    utc.getUTCFullYear() === y &&
    utc.getUTCMonth() === mo - 1 &&
    utc.getUTCDate() === d
  );
}

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
  .strict()
  .superRefine((k, ctx) => {
    if (k.expires !== undefined && !isRealCalendarDate(k.expires)) {
      ctx.addIssue({
        code: "custom",
        path: ["expires"],
        message: `knownViolations entry ${k.rule} ${k.file} ${k.specifier}: 'expires' is not a real calendar date (${k.expires})`,
      });
    }
  });

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
