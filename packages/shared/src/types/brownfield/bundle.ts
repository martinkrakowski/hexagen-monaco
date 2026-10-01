import { z } from "zod";
import {
  FilePathString,
  IsoDateTime,
  SchemaVersion,
  Sha256Hex,
} from "./common.js";

/**
 * Bundle paths that must never be listed: the signing key, any `*.key` file, anything under a
 * `keys/` directory, and env files (plan §4.8).
 */
export const BUNDLE_FORBIDDEN_PATH_PATTERN =
  "(^|/)(grant-signing\\.key|[^/]*\\.key|keys|\\.env[^/]*)(/|$)";
const forbidden = new RegExp(BUNDLE_FORBIDDEN_PATH_PATTERN);

/** A bundle entry names a file (no trailing `/`), never a key or env file. */
const BundlePath = FilePathString.refine((p) => !forbidden.test(p), {
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
