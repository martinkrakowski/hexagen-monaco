import type {
  PortMap,
  PortDefinition,
  AdapterBindings,
  AdapterBinding,
  ClassifiedContext,
} from "../value-objects/pipeline-state";
import { normalizeContextName, toPascalCase } from "./normalize-draft";

export interface SynthesizedRepositoryPort {
  contextName: string;
  portName: string;
  adapterName: string;
}

/** Fixed shape for the synthesized repository adapter (explicit, never inferred). */
const REPOSITORY_ADAPTER = {
  type: "Repository",
  adapterType: "Repository",
} as const satisfies Pick<AdapterBinding, "type" | "adapterType">;

/**
 * Satisfy the R03 invariant at the source: every non-shared-kernel context must
 * expose at least one outbound repository port. When Stage 3 produces a context
 * with inbound ports but no outbound repository port, this appends a default
 * `<Aggregate>RepositoryPort` plus a matching `<Aggregate>RepositoryAdapter`.
 *
 * Why here (orchestrator, on the merged port-map / adapter-bindings) and not in
 * the rendered manifest: Stage 6 and the Stage-7 deterministic gate read the
 * EXPLICIT `mergedPortMap` / `mergedAdapterBindings` (typed ports + typed
 * `implements`), not a name-only YAML. Synthesizing here means:
 *   - the port carries `type: "repository"` directly, so R03 can't fire, and
 *   - the adapter carries `implements: <portName>` directly, so R04 is satisfied
 *     without going through `inferAdapterImplements` — the name-matching pass
 *     whose reshuffle turns a single add-out-port repair into a cascade.
 * The Stage-5 assembly consumes the same merged structures, so the port/adapter
 * also flow into the rendered manifest automatically.
 *
 * Pure: returns augmented copies (no input mutation) plus the list of additions
 * so the caller can surface an advisory warning. Returns the inputs unchanged
 * when nothing needs synthesizing.
 */
export function synthesizeMissingRepositoryPorts(
  portMap: PortMap,
  adapterBindings: AdapterBindings,
  contexts: ReadonlyArray<
    Pick<ClassifiedContext, "name" | "type" | "aggregateRoots">
  >,
): {
  portMap: PortMap;
  adapterBindings: AdapterBindings;
  synthesized: SynthesizedRepositoryPort[];
} {
  const typeByContext = new Map<string, ClassifiedContext["type"]>();
  const aggregateByContext = new Map<string, string>();
  for (const ctx of contexts) {
    const key = normalizeContextName(ctx.name);
    typeByContext.set(key, ctx.type);
    const aggregate = ctx.aggregateRoots?.find((a) => a.trim().length > 0);
    if (aggregate) aggregateByContext.set(key, aggregate);
  }

  const synthesized: SynthesizedRepositoryPort[] = [];

  const augmentedPortContexts = portMap.contexts.map((ctx) => {
    const key = normalizeContextName(ctx.contextName);
    // R03 excludes shared-kernel contexts; skip a context that already has one.
    if (typeByContext.get(key) === "shared-kernel") return ctx;
    if (ctx.out.some((port) => port.type === "repository")) return ctx;

    const aggregate =
      aggregateByContext.get(key) ?? toPascalCase(ctx.contextName);
    // Guard against a `…Repository` aggregate yielding `…RepositoryRepositoryPort`.
    const base =
      aggregate.replace(/Repository$/i, "") || toPascalCase(ctx.contextName);
    const portName = `${base}RepositoryPort`;
    const adapterName = `${base}RepositoryAdapter`;

    synthesized.push({ contextName: ctx.contextName, portName, adapterName });

    const port: PortDefinition = {
      name: portName,
      type: "repository",
      description: `Persistence for ${base}`,
      forAggregate: base,
      justification:
        "Auto-added to satisfy the outbound-repository-port invariant (R03); Stage 3 produced none.",
    };
    return { ...ctx, out: [...ctx.out, port] };
  });

  if (synthesized.length === 0) {
    return { portMap, adapterBindings, synthesized };
  }

  const synthByContext = new Map(
    synthesized.map((s) => [normalizeContextName(s.contextName), s]),
  );
  const adapterContextKeys = new Set<string>();
  const augmentedAdapterContexts = adapterBindings.contexts.map((ctx) => {
    const key = normalizeContextName(ctx.contextName);
    adapterContextKeys.add(key);
    const entry = synthByContext.get(key);
    if (!entry) return ctx;
    const adapter: AdapterBinding = {
      name: entry.adapterName,
      implements: entry.portName,
      ...REPOSITORY_ADAPTER,
    };
    return { ...ctx, adapters: [...ctx.adapters, adapter] };
  });

  // A context can have a port-map entry but no adapter-bindings entry at all
  // (Stage 4 produced none) — add a fresh entry so the new port is covered.
  for (const entry of synthesized) {
    const key = normalizeContextName(entry.contextName);
    if (adapterContextKeys.has(key)) continue;
    augmentedAdapterContexts.push({
      contextName: entry.contextName,
      adapters: [
        {
          name: entry.adapterName,
          implements: entry.portName,
          ...REPOSITORY_ADAPTER,
        },
      ],
    });
  }

  return {
    portMap: { contexts: augmentedPortContexts },
    adapterBindings: { contexts: augmentedAdapterContexts },
    synthesized,
  };
}
