import type {
  BoundedContext,
  PeerContextMapping,
} from "@hexagen/project-configuration";

interface CreateDefaultMappingOptions {
  boundedContexts: BoundedContext[];
  isStrictTemplate: boolean;
}

/**
 * Factory for a fresh PeerContextMapping between the first two
 * bounded contexts. Returns null if fewer than two contexts exist
 * (in which case mappings aren't addable — the parent guards this).
 *
 * Communication boundary defaults to "networked" in strict workspace
 * templates (which disallow in-process calls between contexts) and
 * "in-process" otherwise.
 */
export function createDefaultMapping({
  boundedContexts,
  isStrictTemplate,
}: CreateDefaultMappingOptions): PeerContextMapping | null {
  if (boundedContexts.length < 2) return null;
  return {
    consumerContext: boundedContexts[0]?.id ?? "",
    providerContext: boundedContexts[1]?.id ?? "",
    integrationPattern: "open-host",
    communicationBoundary: isStrictTemplate ? "networked" : "in-process",
  };
}
