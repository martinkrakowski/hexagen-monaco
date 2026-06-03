import { z } from "zod";

/**
 * Canonical bounded-context-type values (DDD strategic classification).
 *
 * Single source of truth. `@hexagen/project-configuration` and
 * `@hexagen/agentic-interaction` derive their schemas from this list so the
 * values can't drift — historically the copies in those packages were missing
 * `"driver"` and were case-sensitive, so a manifest with `type: "driver"` (or a
 * capitalized value like `"Core"`) failed validation in some paths but not
 * others.
 */
export const BOUNDED_CONTEXT_TYPES = [
  "core",
  "supporting",
  "generic",
  "shared-kernel",
  "driver",
] as const;

export type BoundedContextType = (typeof BOUNDED_CONTEXT_TYPES)[number];

/**
 * Case-insensitive schema for the canonical values. LLM-generated manifests
 * frequently vary casing (e.g. `"Core"`); the input is trimmed and lowercased
 * to the canonical form before validation.
 */
export const boundedContextTypeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.enum(BOUNDED_CONTEXT_TYPES),
);
