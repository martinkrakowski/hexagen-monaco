/**
 * Add-on → canvas overlay join (pure; annotate-only).
 *
 * Maps the wizard's selected add-ons to canvas overlay descriptors, per the
 * visualizer-hydration design note (docs/planning/hydrate-visualizer-with-addons.md).
 * It NEVER mutates the manifest/wizardData (AC-3) — it only describes what the
 * renderer should overlay. Kept as a pure function (no React, no generated-bundle
 * import) so the join rules are verifiable without a canvas render.
 *
 * The keys of `addOnsAnswers` are the selected template ids; per-add-on question
 * answers (e.g. a queue name) do not affect the diagram and are ignored here.
 */

/** Compass adapter fields a context-scoped capability can annotate. */
export type CompassAdapterField = "messagingAdapter" | "persistenceAdapter";

/**
 * Capability → the compass adapter field it annotates. A capability absent here
 * (e.g. `external-integration.out-adapter`, `llm.out-adapter`) has no dedicated
 * compass slot and always takes the badge fallback.
 */
const FIELD_BY_CAPABILITY: Readonly<Record<string, CompassAdapterField>> = {
  "messaging.out-adapter": "messagingAdapter",
  "persistence.out-adapter": "persistenceAdapter",
};

/** The mapping metadata the join needs (a structural subset of the web bundle's
 * `TemplateManifestMeta` — kept local so this module stays decoupled from it). */
export interface AddOnMeta {
  provides?: string;
  scope?: "context" | "shared" | "project";
}

export type AddOnMetaLookup = (id: string) => AddOnMeta | undefined;

/** The bounded-context fields the join reads (structural subset of `BoundedContext`). */
export interface OverlayContext {
  id: string;
  messagingAdapter?: string;
  persistenceAdapter?: string;
}

/** A computed overlay element, consumed by the canvas renderer (step 3). */
export type AddOnOverlay =
  | {
      /**
       * Annotate the context's existing compass adapter node. AC-2: when the
       * field is declared, the renderer marks THAT node as add-on-provided
       * rather than drawing a second one.
       */
      kind: "context-adapter";
      addOnId: string;
      capability: string;
      contextId: string;
      field: CompassAdapterField;
    }
  | {
      /** A shared-kernel domain primitive (e.g. `kernel.user-context`). */
      kind: "shared-kernel";
      addOnId: string;
      capability: string;
    }
  | {
      /**
       * A chip in the project-level platform zone. `reason` distinguishes a
       * genuine project-scoped add-on from a context-scoped one with no declared
       * host slot (badge fallback — "selected, not yet assigned to a context") so
       * the diagram never fabricates adapter ownership on a guessed context
       * (Q3 / annotate-only).
       */
      kind: "platform-zone";
      addOnId: string;
      capability: string;
      reason: "project" | "no-host" | "no-compass-field";
    };

export function computeAddOnOverlay(
  addOnsAnswers: Readonly<Record<string, unknown>>,
  lookup: AddOnMetaLookup,
  boundedContexts: readonly OverlayContext[],
): AddOnOverlay[] {
  const overlays: AddOnOverlay[] = [];

  for (const addOnId of Object.keys(addOnsAnswers)) {
    const meta = lookup(addOnId);
    // Unmapped add-on (no provides/scope) → no overlay. They are a pair upstream,
    // but guard both defensively.
    if (!meta?.provides || !meta.scope) continue;
    const capability = meta.provides;

    if (meta.scope === "project") {
      overlays.push({
        kind: "platform-zone",
        addOnId,
        capability,
        reason: "project",
      });
      continue;
    }
    if (meta.scope === "shared") {
      overlays.push({ kind: "shared-kernel", addOnId, capability });
      continue;
    }

    // scope === "context"
    const field = FIELD_BY_CAPABILITY[capability];
    if (!field) {
      // No dedicated compass field (external-integration, llm) → badge.
      overlays.push({
        kind: "platform-zone",
        addOnId,
        capability,
        reason: "no-compass-field",
      });
      continue;
    }

    const hosts = boundedContexts.filter((c) => (c[field] ?? "") !== "");
    if (hosts.length === 0) {
      // Field-mapped but no context declares it → badge ("selected, not yet
      // assigned"); never a fabricated slot on a guessed context.
      overlays.push({
        kind: "platform-zone",
        addOnId,
        capability,
        reason: "no-host",
      });
      continue;
    }
    // Annotate every declaring context (Q1: show on all matching contexts).
    for (const ctx of hosts) {
      overlays.push({
        kind: "context-adapter",
        addOnId,
        capability,
        contextId: ctx.id,
        field,
      });
    }
  }

  return overlays;
}
