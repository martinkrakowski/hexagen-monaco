/**
 * Pure provenance-layer derivation for the accept-save step.
 *
 * Extracted from ManifestAcceptPage so the guard logic (session-vs-imported
 * spec matching) is unit-testable without mounting the page. Two branches:
 *
 * 1. Live-session provenance (Plan phase finalize): when the spec the import
 *    flow consumed is EXACTLY the distilled text the user confirmed, attach
 *    the FULL brainstorm transcript as a completed layer. The equality guard
 *    means an abandoned finalize can't leak its session onto an unrelated
 *    later import.
 * 2. Plain spec import: a single-turn "Imported project spec" layer.
 */

import type { NewProjectLayer } from "../../app/hooks/useSavedProjects";
import type { PendingSessionProvenance } from "./store/usePendingManifest";

export function sessionMatchesSpec(
  session: PendingSessionProvenance | null,
  importedSpec: string | null,
): session is PendingSessionProvenance {
  return (
    session !== null &&
    importedSpec !== null &&
    session.specText.trim() === importedSpec.trim()
  );
}

export function deriveInitialLayers(
  importedSpec: string | null,
  session: PendingSessionProvenance | null,
  now: number = Date.now(),
): NewProjectLayer[] {
  if (sessionMatchesSpec(session, importedSpec)) {
    return [
      {
        kind: "brainstorm" as const,
        title: "Live planning session",
        turns: session.turns.map((t) => ({ ...t })),
        status: "done" as const,
        link: { type: "produced-manifest" as const, at: now },
      },
    ];
  }
  if (importedSpec?.trim()) {
    return [
      {
        kind: "brainstorm" as const,
        title: "Imported project spec",
        turns: [
          {
            id: crypto.randomUUID(),
            author: "Imported",
            content: importedSpec,
            at: now,
          },
        ],
      },
    ];
  }
  return [];
}
