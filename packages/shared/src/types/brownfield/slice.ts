import { z } from "zod";
import { IsoDateTime, Repo, SchemaVersion, SlicePathString } from "./common.js";

/**
 * `.hexagen/slice.json`: the part of the repo an agent is bound to. Everything
 * outside `paths`, or inside `excludes`, is denied. Path rules live in
 * `slice-path.ts`.
 */
export const Slice = z
  .object({
    schemaVersion: SchemaVersion,
    id: z.string().min(1),
    repo: Repo,
    paths: z.array(SlicePathString),
    excludes: z.array(SlicePathString),
    createdBy: z.string().min(1),
    createdAt: IsoDateTime,
  })
  .strict();

export type Slice = z.infer<typeof Slice>;
