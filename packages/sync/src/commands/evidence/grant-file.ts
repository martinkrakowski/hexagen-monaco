import { z } from "zod";
import type { PackGrant } from "./check.js";

/** RFC 3339 date-time with a mandatory offset, and a real calendar instant. */
const isoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/,
    "must be an ISO date-time with an offset, e.g. 2026-10-01T18:00:00Z",
  )
  .refine(
    (value) => !Number.isNaN(Date.parse(value)),
    "is not a real date-time",
  );

/**
 * The wire shape of a signed grant (docs/kernel/grant.schema.json), the same
 * strict shape `hexagen grant check` loads. Unknown fields are refused: they
 * would be unsigned. A grant that fails it is not "verified", so every line
 * that cites it fails.
 */
export const PackGrantFile = z
  .object({
    id: z.string().min(1),
    principal: z.string().min(1),
    agent: z.string().min(1),
    contexts: z.array(z.string().min(1)).optional(),
    paths: z.array(z.string().min(1)),
    tools: z.array(z.string().min(1)),
    mode: z.enum(["write", "propose"]),
    max_files: z.number().int().min(1).optional(),
    expires_at: isoDateTime,
    revoked_at: isoDateTime.optional(),
    signature: z.string().optional(),
  })
  .strict();

export type ParsedPackGrant =
  | { readonly ok: true; readonly grant: PackGrant }
  | { readonly ok: false; readonly problem: string };

export function parsePackGrant(json: unknown): ParsedPackGrant {
  const parsed = PackGrantFile.safeParse(json);
  if (parsed.success) return { ok: true, grant: parsed.data };
  const issue = parsed.error.issues[0];
  return {
    ok: false,
    problem: `not a valid grant: ${issue?.path.join(".") || "(root)"}: ${issue?.message}`,
  };
}
