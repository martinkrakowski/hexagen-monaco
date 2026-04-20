import type {
  BoundedContext,
  PeerContextMapping,
} from "@hexagen/project-configuration";

/**
 * PeerContextMapping has no native id; mappings are identified by
 * the (consumerContext, providerContext) pair. This synthesises a
 * stable string key for list rendering, selection, and delete ops.
 *
 * The format matches what was inlined as `${m.consumerContext}-
 * ${m.providerContext}` across the original step component.
 */
export function getMappingId(mapping: PeerContextMapping): string {
  return `${mapping.consumerContext}-${mapping.providerContext}`;
}

/**
 * Resolves a bounded-context id to its display name. Falls back to
 * "Unnamed" when the id doesn't match a known context (e.g. after
 * a context was deleted upstream).
 */
export function getContextName(
  contextId: string,
  boundedContexts: BoundedContext[],
): string {
  const ctx = boundedContexts.find((c) => c.id === contextId);
  return ctx?.name || "Unnamed";
}
