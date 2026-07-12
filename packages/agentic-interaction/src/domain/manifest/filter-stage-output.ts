import { normalizeContextName } from "./normalize-draft";

/**
 * Keep only stage-LLM output entries for contexts that were actually REQUESTED.
 *
 * Stage 3/4 prompts show the model the FULL port map for grounding while asking
 * it to produce output for a subset (contexts without pre-defined ports /
 * adapters). Models sometimes echo entries for the grounding-only contexts; the
 * orchestrator concatenates stage output onto the pre-defined entries, so an
 * echo lands as a DUPLICATE context entry in the merged structure. Downstream
 * that duplicate is load-bearing damage: the R03 synthesizer appended its
 * repository adapter once per matching entry, the R12 dedupe then "fixed" the
 * self-collision by minting a stuttered name (RealEsrganRealEsrganRepository-
 * Adapter, alvaro-ai), and the double assignment surfaced as a phantom R04.
 *
 * Pure; returns the kept entries plus the dropped context names so the caller
 * can disclose the drop (never silently).
 */
export function filterToRequestedContexts<T extends { contextName: string }>(
  entries: readonly T[],
  requestedNames: Iterable<string>,
): { kept: T[]; droppedContextNames: string[] } {
  const requested = new Set(
    [...requestedNames].map((name) => normalizeContextName(name)),
  );
  const kept: T[] = [];
  const droppedContextNames: string[] = [];
  for (const entry of entries) {
    if (requested.has(normalizeContextName(entry.contextName))) {
      kept.push(entry);
    } else {
      droppedContextNames.push(entry.contextName);
    }
  }
  return { kept, droppedContextNames };
}
