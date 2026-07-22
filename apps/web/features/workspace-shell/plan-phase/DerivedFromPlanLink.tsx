"use client";

import { useWizardLifecycleContext } from "../contexts/WizardLifecycleContext";

interface DerivedFromPlanLinkProps {
  /** Switches to the Plan phase (?phase=plan). Fires on user click only. */
  onNavigateToPlan: () => void;
}

/**
 * Compact Architecture-phase provenance affordance: shown next to the phase
 * switcher when any planning layer carries the produced-manifest link, i.e.
 * the current architecture was derived from a stored planning session.
 *
 * Consumes the wizard lifecycle context ITSELF (rather than receiving layers
 * via a layout prop) so the React.memo'd ProjectWorkspaceLayout never gains a
 * new prop for its hand-picked equality comparator to miss — only this small
 * component re-renders when the project record changes.
 */
export function DerivedFromPlanLink({
  onNavigateToPlan,
}: DerivedFromPlanLinkProps) {
  const { loadedProject } = useWizardLifecycleContext();

  const hasProvenance =
    loadedProject?.layers.some(
      (layer) => layer.link?.type === "produced-manifest",
    ) ?? false;
  if (!hasProvenance) return null;

  return (
    <button
      type="button"
      onClick={onNavigateToPlan}
      className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
    >
      {/* Short label on narrow screens — the Header slot renders at both
          breakpoints and mobile can't fit the full sentence. */}
      <span className="hidden md:inline">
        Derived from your planning session
      </span>
      <span className="md:hidden">From plan</span>
      {" →"}
    </button>
  );
}
