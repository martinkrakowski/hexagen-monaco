import { PLANE_NAMES } from "@hexagen/project-configuration";
import {
  CONTEXT_NAME_GENERATION_BANS,
  STRUCTURAL_NOUNS,
} from "./architecture-contract";

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
 * Uses CONTEXT_NAME_GENERATION_BANS (the Stage 2 generation-guidance list)
 * because this is generation-side guidance; the known divergence between the
 * three ban lists is documented in architecture-contract.ts and reconciled in
 * its own HITL-gated PR (A2), not here.
 */
export function buildGreenfieldArchitectureContext(): string {
  return [
    "Target architecture: hexagonal (ports & adapters) with bounded contexts assigned to planes.",
    `Planes: ${PLANE_NAMES.join(", ")}.`,
    `Bounded contexts are named after business capabilities, never after infrastructure or layering tokens (banned in context names: ${CONTEXT_NAME_GENERATION_BANS.join(", ")}).`,
    `Structural nouns (${STRUCTURAL_NOUNS.join(", ")}) are legitimate inside PORT names (e.g. OrderRepositoryPort) but banned in context names.`,
  ].join("\n");
}
