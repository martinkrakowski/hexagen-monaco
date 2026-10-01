import { z } from "zod";
import { normalizeSlicePath } from "./slice-path.js";

/** Current schema version string every brownfield format carries. */
export const BROWNFIELD_SCHEMA_VERSION = "1.0.0";

/** Pattern for `schemaVersion`: this consumer understands the 1.x line only. */
export const SCHEMA_VERSION_PATTERN = "^1\\.\\d+\\.\\d+$";

export const SchemaVersion = z
  .string()
  .regex(new RegExp(SCHEMA_VERSION_PATTERN), {
    message: "Unsupported schemaVersion; this consumer understands 1.x.y",
  });

/** A repo-relative slice path (see `normalizeSlicePath`). */
export const SlicePathString = z
  .string()
  .refine((p) => normalizeSlicePath(p).ok, {
    message: "invalid slice path",
  });

/** A repo-relative file path: a slice path with no trailing `/`. */
export const FilePathString = SlicePathString.refine((p) => !p.endsWith("/"), {
  message: "a file path must not end in /",
});

export const Repo = z
  .object({
    remote: z.string().min(1).optional(),
    commit: z.string().min(1),
  })
  .strict();

export const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

export const IsoDateTime = z.string().datetime({ offset: true });
