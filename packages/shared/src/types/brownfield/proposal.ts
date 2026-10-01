import { z } from "zod";
import { FilePathString, IsoDateTime } from "./common.js";

/** `.hexagen/proposals/<id>.json`: metadata beside `<id>.patch`. */
export const ProposalMeta = z
  .object({
    id: z.string().min(1),
    grantId: z.string().min(1),
    sliceId: z.string().min(1),
    tool: z.string().min(1),
    paths: z.array(FilePathString),
    traceSeq: z.number().int().min(0),
    createdAt: IsoDateTime,
  })
  .strict();

export type ProposalMeta = z.infer<typeof ProposalMeta>;
