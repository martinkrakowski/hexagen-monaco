import type { WizardData } from "@hexagen/project-configuration";

/**
 * The canvas redraw signature: the slice of `wizardData` that actually changes
 * the rendered diagram — the bounded/external contexts + peer mappings (the
 * compass) and the **selected add-on id-set** (the overlay keys on ids, not on
 * per-add-on question answers).
 *
 * A per-add-on answer-value change (e.g. a queue name) or a governance edit
 * leaves this stable, so the expensive compass regeneration is skipped — while
 * `wizardData` itself stays fresh for non-canvas consumers (generation/export;
 * see `useWizardForm`). This is the "ignore answer-only changes" optimization in
 * the canvas layer, where it belongs (NOT in the shared wizardData provider,
 * where it would freeze the object and ship stale add-on answers downstream).
 */
export function canvasRedrawKey(wizardData: WizardData): unknown {
  return {
    boundedContexts: wizardData.boundedContexts,
    externalContexts: wizardData.externalContexts,
    peerMappings: wizardData.peerMappings,
    addOnIds: Object.keys(wizardData.addOnsAnswers ?? {}).sort(),
  };
}
