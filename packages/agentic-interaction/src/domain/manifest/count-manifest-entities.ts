export interface ManifestEntityCounts {
  contextCount: number;
  portCount: number;
  adapterCount: number;
}

/**
 * Count bounded contexts, ports and adapters in an assembled manifest object
 * (the parsed `draftToManifest` output — i.e. `assembledManifest.parsedObject`).
 *
 * Ports and adapters live under `layers.application.ports.{in,out}` and
 * `layers.infrastructure.adapters`, NOT at the context root. Reading the root
 * (`ctx.ports` / `ctx.adapters`) — as `execute-structured-config-generation`
 * did — always counts 0. This is the single correct counter shared by the full
 * 0→6 pipeline and the structured-config (import) pipeline when they record
 * transaction metadata, so the two can never drift again (A2/A4 helper).
 */
export function countManifestEntities(parsed: unknown): ManifestEntityCounts {
  const root = (parsed ?? {}) as { bounded_contexts?: unknown };
  const rawContexts = Array.isArray(root.bounded_contexts)
    ? root.bounded_contexts
    : [];
  // A malformed manifest can carry null / primitive list items (an empty YAML
  // `-` parses to null); count only real object contexts so the helper honours
  // its "never throws" contract and contextCount stays meaningful.
  const contexts = rawContexts.filter(
    (
      c,
    ): c is {
      layers?: {
        application?: { ports?: { in?: unknown[]; out?: unknown[] } };
        infrastructure?: { adapters?: unknown[] };
      };
    } => c != null && typeof c === "object",
  );

  let portCount = 0;
  let adapterCount = 0;
  for (const ctx of contexts) {
    const ports = ctx.layers?.application?.ports;
    portCount +=
      (Array.isArray(ports?.in) ? ports.in.length : 0) +
      (Array.isArray(ports?.out) ? ports.out.length : 0);
    const adapters = ctx.layers?.infrastructure?.adapters;
    adapterCount += Array.isArray(adapters) ? adapters.length : 0;
  }

  return { contextCount: contexts.length, portCount, adapterCount };
}
