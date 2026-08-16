/**
 * Typed patch metadata for speculative transactions (AUD-004).
 *
 * `Transaction.metadata` is `Record<string, unknown>` — deliberately open, so
 * any pipeline can attach its own bookkeeping. The architecture-modification
 * pipeline stores the speculative `Patch[]` there and the accept saga reads it
 * back out later, in a different process tick and a different bounded context.
 *
 * That round trip used to be an `as Patch[]` assertion at the read end. An
 * assertion is not a check: it tells the compiler to stop asking, and every
 * malformed value survives it. A missing key produced a silent zero-patch
 * "success"; a string produced `patchesApplied: "oops".length === 4`; an array
 * of arbitrary objects went straight to the mutation adapter.
 *
 * The fix is a pair, not a cast:
 *   - {@link createPatchMetadata} types the WRITE, so a producer that stores
 *     the wrong shape fails to compile;
 *   - {@link readPatchMetadata} validates the READ, so a producer that was
 *     never compiled against this module (or a transaction from an unrelated
 *     pipeline) is rejected at runtime with a reason instead of being waved
 *     through.
 *
 * Neither function contains a type assertion. {@link isPatch} is a real type
 * predicate: its body checks every field of `Patch`, so the narrowing it
 * performs is earned rather than declared.
 */

import type { Patch } from "@hexagen/core-domain";

/** The metadata key the architecture-modification pipeline writes patches to. */
export const PATCHES_METADATA_KEY = "patches";

/**
 * Transaction metadata that carries a speculative patch set. Extends the open
 * record so it remains assignable to `Transaction.metadata` while pinning the
 * one key the accept saga depends on.
 */
export interface PatchMetadata extends Record<string, unknown> {
  [PATCHES_METADATA_KEY]: Patch[];
}

/**
 * Build transaction metadata carrying `patches`, merged over any pipeline
 * bookkeeping in `base`.
 *
 * This is the compile-time half of the guard. `patches` is typed `Patch[]`, so
 * a producer cannot store a string, a partially-built object, or a differently
 * shaped "patch" without a compiler error at the write site — which is where
 * the mistake is cheap to see. `base` is spread FIRST so it can never shadow
 * the typed `patches` key with an untyped value of its own.
 */
export function createPatchMetadata(
  patches: Patch[],
  base: Record<string, unknown> = {},
): PatchMetadata {
  return { ...base, [PATCHES_METADATA_KEY]: patches };
}

const PATCH_TYPES = [
  "add_node",
  "remove_node",
  "add_edge",
  "remove_edge",
  "update_node",
  "update_edge",
] as const;

function isPatchType(value: unknown): value is Patch["type"] {
  // `includes` on a readonly tuple needs a widened receiver; comparing against
  // the string list directly keeps the check assertion-free.
  return (
    typeof value === "string" &&
    PATCH_TYPES.some((candidate) => candidate === value)
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Real type predicate for {@link Patch} — every field of the interface is
 * checked here. If `Patch` ever grows a required field, this function must grow
 * with it; a predicate that stops covering its type is just a cast wearing a
 * signature.
 */
export function isPatch(value: unknown): value is Patch {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.id === "string" &&
    isPatchType(value.type) &&
    typeof value.targetId === "string" &&
    isPlainObject(value.payload)
  );
}

/** Outcome of reading patch metadata off a transaction. */
export type PatchMetadataRead =
  | { readonly ok: true; readonly patches: Patch[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Read the speculative patch set off transaction metadata, validating it.
 *
 * An ABSENT `patches` key is an error, not an empty set: the accept saga's
 * caller has already established that this is a speculative transaction from
 * the modification pipeline, and that pipeline always writes the key. Treating
 * absence as `[]` is what let a broken producer read as a successful
 * zero-patch commit. An empty ARRAY, by contrast, is valid — a modification
 * that legitimately yielded no patches is a real (if boring) transaction.
 */
export function readPatchMetadata(
  metadata: Record<string, unknown>,
): PatchMetadataRead {
  if (!(PATCHES_METADATA_KEY in metadata)) {
    return {
      ok: false,
      reason: "transaction metadata carries no 'patches' key",
    };
  }

  const raw = metadata[PATCHES_METADATA_KEY];
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      reason: `transaction metadata 'patches' is ${raw === null ? "null" : typeof raw}, expected an array`,
    };
  }

  const invalidIndex = raw.findIndex((entry) => !isPatch(entry));
  if (invalidIndex !== -1) {
    return {
      ok: false,
      reason: `transaction metadata 'patches'[${invalidIndex}] is not a well-formed patch`,
    };
  }

  // `raw.every(isPatch)` does not narrow `unknown[]` to `Patch[]` in TypeScript
  // 5.4, so the narrowed array is rebuilt by filtering with the predicate —
  // which DOES narrow — after the loop above has already proven no element can
  // be dropped. No assertion is involved.
  const patches = raw.filter(isPatch);
  return { ok: true, patches };
}
