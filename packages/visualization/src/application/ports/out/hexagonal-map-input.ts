/**
 * The map-drawing vocabulary `@hexagen/visualization` owns (HEX-021).
 *
 * `GenerateHexagonalMapInput` used to be `{ wizardData: WizardData }` — this
 * context's inbound application contract expressed in another context's root
 * aggregate. Two things were wrong with that. Structurally, the layer rules
 * exclude `@hexagen/project-configuration` from application `allowed_imports`
 * (the single granted exception is `architecture-graph.ts`), so the port could
 * not compile without an edge the architecture does not grant. Semantically,
 * `WizardData` is a *wizard form* — governance settings, add-on answers,
 * manifest provenance — and roughly nine tenths of it is invisible to a canvas.
 * Typing the port on it claimed a coupling to all of it.
 *
 * So this context declares what it actually needs, in its own terms, and the
 * translation from the wizard vocabulary happens once, in infrastructure
 * (`wizard-data-to-map-input.ts`) — which is where the finding's own
 * recommendation puts it.
 *
 * Two deliberate shape choices, both to make the boundary do work:
 *
 *  - Scalars are `string`, not the wizard's Zod enum unions. A canvas draws a
 *    label for whatever a context names as its persistence adapter; enumerating
 *    the members here would be a second copy of a list this context does not
 *    own, drifting silently every time the wizard grows an option. Widening is
 *    also the assignable direction, which is what lets the mapper's guard be an
 *    assignment rather than a cast.
 *  - Collections are `readonly`. This is an input the caller still owns; the
 *    generator reads it and must not alias it into the graph it returns.
 *
 * Fields are declared required exactly where the wizard schema declares them
 * required, so that a field turning optional upstream fails the mapper's
 * assignment instead of silently becoming `undefined` at a call site.
 */

/** One bounded context, as far as drawing a hexagon is concerned. */
export interface MapContextInput {
  readonly id: string;
  readonly name: string;
  /** Preferred entity source; `entities` is the legacy fallback. */
  readonly coreDomainEntities?: readonly string[];
  readonly entities?: readonly string[];
  readonly useCases?: readonly string[];
  readonly valueObjects?: readonly string[];
  readonly domainEvents?: readonly string[];
  /** North compass label, preferred over `apiFramework` when present. */
  readonly infrastructureTarget?: string;
  readonly apiFramework?: string;
  /** West compass items. */
  readonly uiFramework?: string;
  /** East compass items. */
  readonly persistenceAdapter?: string;
  /** South compass items. */
  readonly messagingAdapter?: string;
  readonly telemetryProvider?: string;
  readonly portConfiguration?: {
    readonly inboundPorts?: readonly string[];
    readonly outboundPorts?: readonly string[];
  };
}

/** One external/peer context and its relationship to the core. */
export interface MapPeerInput {
  readonly id: string;
  readonly name: string;
  /** `U` / `D` / `ACL` / `SK` / `P` / `OHS` — drawn verbatim on the edge. */
  readonly relationshipType: string;
  readonly entityNames?: readonly string[];
  readonly useCaseNames?: readonly string[];
}

/** A declared consumer→provider mapping between two of the contexts above. */
export interface MapPeerMappingInput {
  readonly consumerContext: string;
  readonly providerContext: string;
  readonly integrationPattern: string;
}

/** Everything a hexagonal context map is generated from. */
export interface HexagonalMapInput {
  readonly contexts: readonly MapContextInput[];
  readonly peers: readonly MapPeerInput[];
  readonly peerMappings: readonly MapPeerMappingInput[];
}
