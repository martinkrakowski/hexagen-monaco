import { z } from "zod";
import { IsoDateTime, SchemaVersion, Sha256Hex } from "./common.js";
import { normalizeSlicePath } from "./slice-path.js";

/**
 * Bundle paths that must never be listed: the signing key, anything under a
 * `keys/` directory, and env files (plan §4.8).
 */
export const BUNDLE_FORBIDDEN_PATH_PATTERN =
  "(^|/)(grant-signing\\.key|keys|\\.env[^/]*)(/|$)";
const forbidden = new RegExp(BUNDLE_FORBIDDEN_PATH_PATTERN);

const BundlePath = z
  .string()
  .refine((p) => normalizeSlicePath(p).ok, { message: "invalid path" })
  .refine((p) => !forbidden.test(p), {
    message: "key and env files are never part of a bundle",
  });

export const BUNDLE_FILE_ROLES = [
  "observed",
  "slice",
  "contract",
  "grant",
  "proposal",
  "evidence",
  "tip",
] as const;

const BundleFile = z
  .object({
    path: BundlePath,
    role: z.enum(BUNDLE_FILE_ROLES),
    sha256: Sha256Hex,
  })
  .strict();

/**
 * `bundle.json`: the index of a workbook export zip. `hmac` is the pack HMAC
 * (hex) over the index without this field, keyed by the engagement key.
 */
export const BundleIndex = z
  .object({
    schemaVersion: SchemaVersion,
    createdAt: IsoDateTime,
    sliceId: z.string().min(1),
    files: z.array(BundleFile),
    hmac: Sha256Hex,
  })
  .strict();

export type BundleIndex = z.infer<typeof BundleIndex>;
