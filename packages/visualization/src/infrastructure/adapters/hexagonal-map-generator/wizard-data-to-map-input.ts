import type {
  BoundedContext,
  ExternalContext,
  PeerMapping,
  WizardData,
} from "@hexagen/project-configuration";

import type {
  HexagonalMapInput,
  MapContextInput,
  MapPeerInput,
  MapPeerMappingInput,
} from "../../../application/ports/in/hexagonal-map-input.js";

/**
 * The one place in `@hexagen/visualization` that speaks the wizard vocabulary.
 *
 * HEX-021's recommendation is "map `WizardData` only in infrastructure or at
 * the composition root". Infrastructure, because `@hexagen/visualization` is a
 * published dependency of `@hexagen/sync` and every caller that has a
 * `WizardData` would otherwise write this projection itself — three copies of
 * one boundary is how the sibling finding REA-005 happened.
 *
 * ## The drift guard
 *
 * The three lines below are **assignments, not casts**, and they are the guard.
 * Precedent: item 5.2 (#490) put the equivalent line in `ExternalSyncEngineAdapter`
 * rather than in a test, on the reasoning that a boundary worth having should
 * stop the adapter compiling — `as HexagonalMapInput` here would silence
 * exactly what the DTO exists to catch.
 *
 * An assignment catches one direction: a wizard field whose *type* stops being
 * compatible with what the DTO declares. It cannot catch a field being
 * *renamed*, because a DTO field the source object simply lacks is legal for an
 * optional member — and a silently-renamed `persistenceAdapter` would blank a
 * whole compass side with no error anywhere. The `keyof … extends keyof …`
 * witnesses close that second direction, in production code, at compile time.
 *
 * `keyof` is top-level only, so one witness per interface is not enough: it
 * proves `portConfiguration` still exists without saying anything about what is
 * inside it. Renaming `PortConfigurationSchema`'s `inboundPorts` upstream left
 * `yarn typecheck` green here while `generate-compass-nodes.ts` — which reads
 * `ctx.portConfiguration?.inboundPorts ?? []` — silently emitted zero north
 * compass nodes. Every nested object the DTO declares therefore gets its own
 * witness below, and any nested object added later needs one too.
 */

/**
 * Every field name the DTO declares must still exist on the wizard type it is
 * projected from. `keyof` on a concrete interface is a literal union, so this
 * is checked as a whole: `true` only when every DTO key is also a source key.
 * When it is not, the constant below fails to compile and the error names the
 * keys that no longer exist upstream.
 */
type EveryKeyIsSuppliedBy<Dto, Source> = [
  Exclude<keyof Dto, keyof Source>,
] extends [never]
  ? true
  : ["fields missing upstream:", Exclude<keyof Dto, keyof Source>];

/**
 * The nested object behind an optional member, with `undefined` stripped so
 * `keyof` sees the members rather than `never`. Indexing is deliberate: if the
 * member itself disappears upstream, this stops compiling here too.
 */
type Inside<T, K extends keyof T> = NonNullable<T[K]>;

export const WIZARD_STILL_SUPPLIES_EVERY_MAPPED_FIELD: [
  EveryKeyIsSuppliedBy<MapContextInput, BoundedContext>,
  EveryKeyIsSuppliedBy<MapPeerInput, ExternalContext>,
  EveryKeyIsSuppliedBy<MapPeerMappingInput, PeerMapping>,
  // Nested: `keyof MapContextInput` above sees only `portConfiguration`.
  EveryKeyIsSuppliedBy<
    Inside<MapContextInput, "portConfiguration">,
    Inside<BoundedContext, "portConfiguration">
  >,
] = [true, true, true, true];

/**
 * Project a wizard document onto the subset a hexagonal context map is drawn
 * from. Structural: no field is copied, so nothing here can silently reorder,
 * default or lose a value.
 */
export function wizardDataToHexagonalMapInput(
  wizardData: WizardData,
): HexagonalMapInput {
  const contexts: readonly MapContextInput[] = wizardData.boundedContexts ?? [];
  const peers: readonly MapPeerInput[] = wizardData.externalContexts ?? [];
  const peerMappings: readonly MapPeerMappingInput[] =
    wizardData.peerMappings ?? [];

  return { contexts, peers, peerMappings };
}
