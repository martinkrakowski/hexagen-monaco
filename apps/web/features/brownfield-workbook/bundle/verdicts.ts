import { z } from "zod";

/**
 * `evidence/verdicts.json` as written by `hexagen evidence pack`. It has no
 * shared schema, so the viewer reads only the fields it shows, leniently.
 */
const Denial = z.object({
  seq: z.number().int().min(0),
  haltReason: z.string().nullish(),
  grantId: z.string().nullish(),
  tool: z.string().nullish(),
  time: z.string().nullish(),
  reason: z.string().nullish(),
});

const Verdicts = z.object({
  lines: z.array(
    z.object({
      seq: z.number().int().min(0),
      kind: z.string(),
      valid: z.boolean(),
      reasons: z.array(z.string()).default([]),
    }),
  ),
  denials: z.array(Denial),
  evidence: z.object({ count: z.number().int().min(0) }),
});

export type PackVerdicts = z.infer<typeof Verdicts>;

export function parseVerdicts(text: string): PackVerdicts | "invalid" {
  try {
    return Verdicts.parse(JSON.parse(text));
  } catch {
    return "invalid";
  }
}
