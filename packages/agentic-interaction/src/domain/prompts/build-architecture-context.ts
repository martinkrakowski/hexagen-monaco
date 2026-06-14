import { PLANE_NAMES } from "@hexagen/project-configuration";
import {
  CONTEXT_NAME_GENERATION_BANS,
  STRUCTURAL_NOUNS,
} from "./architecture-contract";

declare const ARCHITECTURE_CONTEXT_BRAND: unique symbol;

/**
 * A trusted, sanctioned `<architecture>` block for the Stage-0 prompt.
 *
 * `compileStage0Prompt` injects this value **UNESCAPED** (the user input beside
 * it IS escaped), so it is a trust boundary: only an approved builder may
 * produce an `ArchitectureContext`. A raw / user-derived string is a compile
 * error; a deliberate `as ArchitectureContext` cast is the auditable "I vouch
 * this is trusted static config" escape hatch (e.g. a brownfield override). The
 * brand is phantom — compile-time only, zero runtime footprint.
 */
export type ArchitectureContext = string & {
  readonly [ARCHITECTURE_CONTEXT_BRAND]: true;
};

/**
 * Greenfield `<architecture>` context for the Stage 0 normalizer (T2b).
 *
 * Composes the already-banked static contract — the plane vocabulary from
 * `@hexagen/project-configuration` and the context-name token bans from
 * `architecture-contract.ts` — into the block that
 * `compileStage0Prompt(variables, architectureContext)` injects ahead of the
 * user input. Pure and deterministic; orchestrators should call it ONCE at
 * construction time, never per execute().
 *
 * Uses CONTEXT_NAME_GENERATION_BANS (the generation-guidance alias of the
 * canonical unified ban list) because this is generation-side guidance. The
 * ban policy is UNIFIED since A2 — one membership across all sites, with the
 * per-site mechanism deltas (and the prose-only carve-out) documented in
 * architecture-contract.ts.
 */
export function buildGreenfieldArchitectureContext(): ArchitectureContext {
  return [
    "Target architecture: hexagonal (ports & adapters) with bounded contexts assigned to planes.",
    `Planes: ${PLANE_NAMES.join(", ")}.`,
    `Bounded contexts are named after business capabilities, never after infrastructure or layering tokens (banned in context names: ${CONTEXT_NAME_GENERATION_BANS.join(", ")}).`,
    `Structural nouns (${STRUCTURAL_NOUNS.join(", ")}) are legitimate inside PORT names (e.g. OrderRepositoryPort) but banned in context names.`,
  ].join("\n") as ArchitectureContext;
}
