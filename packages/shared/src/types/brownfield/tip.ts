import { z } from "zod";
import { Sha256Hex } from "./common.js";

/** `tip.json`: the anchored head of the trace chain. */
export const Tip = z
  .object({
    seq: z.number().int().min(0),
    hash: Sha256Hex,
    hmac: Sha256Hex,
  })
  .strict();

export type Tip = z.infer<typeof Tip>;
