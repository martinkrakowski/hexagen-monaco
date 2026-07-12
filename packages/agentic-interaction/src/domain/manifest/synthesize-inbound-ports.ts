import type {
  PortMap,
  PortDefinition,
  AdapterBindings,
  AdapterBinding,
  ClassifiedContext,
} from "../value-objects/pipeline-state";
import { normalizeContextName, toPascalCase } from "./normalize-draft";

export interface SynthesizedInboundPort {
  contextName: string;
  portName: string;
  adapterName: string;
}

/** Fixed shape for the synthesized command adapter (explicit, never inferred). */
const COMMAND_ADAPTER = {
  type: "Controller",
  adapterType: "Controller",
} as const satisfies Pick<AdapterBinding, "type" | "adapterType">;

/**
 * Satisfy the R02 minimum-interface invariant at the source: every
 * non-shared-kernel context must expose at least one inbound port. Imported
 * manifest-dialect specs commonly declare only driven ports ("interfaces that
 * Core depends on"), so their core contexts arrive with `in: []`; Stage 6 then
 * reported R02 while the ACCEPT VIEW's client-side auto-fixer silently patched
 * the YAML afterwards — findings and manifest contradicting each other on the
 * same screen (the alvaro-ai import). Synthesizing here, before Stage 6, makes
 * findings and manifest agree by construction and turns the adjustment into a
 * DISCLOSED one.
 *
 * The port name intentionally matches the client fixer's derivation
 * (`toPascalCase(context) + "CommandPort"`, manifest-violation-fixer.ts) so the
 * accept view's minimum-interface branch finds nothing left to patch. A
 * matching adapter is added too — an uncovered inbound port would just trade
 * R02 for R05.
 *
 * Pure: returns augmented copies plus the additions for the caller's advisory
 * warning. Returns the inputs unchanged when nothing needs synthesizing.
 */
export function synthesizeMissingInboundPorts(
  portMap: PortMap,
  adapterBindings: AdapterBindings,
  contexts: ReadonlyArray<Pick<ClassifiedContext, "name" | "type">>,
): {
  portMap: PortMap;
  adapterBindings: AdapterBindings;
  synthesized: SynthesizedInboundPort[];
} {
  const typeByContext = new Map<string, ClassifiedContext["type"]>();
  for (const ctx of contexts) {
    typeByContext.set(normalizeContextName(ctx.name), ctx.type);
  }

  const synthesized: SynthesizedInboundPort[] = [];

  const augmentedPortContexts = portMap.contexts.map((ctx) => {
    const key = normalizeContextName(ctx.contextName);
    // R02 exempts shared-kernel contexts; anything with an inbound port is fine.
    if (typeByContext.get(key) === "shared-kernel") return ctx;
    if (ctx.in.length > 0) return ctx;

    const base = toPascalCase(ctx.contextName);
    const portName = `${base}CommandPort`;
    const adapterName = `${base}CommandAdapter`;

    // Defensive: the name already exists somewhere in this context — don't
    // duplicate; leave R02 to surface as an advisory finding instead.
    if (
      ctx.out.some((p) => p.name === portName) ||
      ctx.in.some((p) => p.name === portName)
    ) {
      return ctx;
    }

    synthesized.push({ contextName: ctx.contextName, portName, adapterName });

    const port: PortDefinition = {
      name: portName,
      type: "command",
      description: `Primary command interface for ${base}`,
      justification:
        "Auto-added to satisfy the minimum-interface invariant (R02); the imported spec declared no inbound ports.",
    };
    return { ...ctx, in: [...ctx.in, port] };
  });

  if (synthesized.length === 0) {
    return { portMap, adapterBindings, synthesized };
  }

  const synthByContext = new Map(
    synthesized.map((s) => [normalizeContextName(s.contextName), s]),
  );
  const implementedByContext = new Map<string, Set<string>>();
  for (const ctx of adapterBindings.contexts) {
    const key = normalizeContextName(ctx.contextName);
    let set = implementedByContext.get(key);
    if (!set) implementedByContext.set(key, (set = new Set<string>()));
    for (const a of ctx.adapters) if (a.implements) set.add(a.implements);
  }
  const adapterContextKeys = new Set<string>();
  // At most one append per context (bindings can hold a context twice) — same
  // hardening as synthesizeMissingRepositoryPorts.
  const appendedKeys = new Set<string>();
  const augmentedAdapterContexts = adapterBindings.contexts.map((ctx) => {
    const key = normalizeContextName(ctx.contextName);
    adapterContextKeys.add(key);
    const entry = synthByContext.get(key);
    if (!entry) return ctx;
    if (appendedKeys.has(key)) return ctx;
    if (implementedByContext.get(key)?.has(entry.portName)) return ctx;
    appendedKeys.add(key);
    const adapter: AdapterBinding = {
      name: entry.adapterName,
      implements: entry.portName,
      ...COMMAND_ADAPTER,
    };
    return { ...ctx, adapters: [...ctx.adapters, adapter] };
  });

  for (const entry of synthesized) {
    const key = normalizeContextName(entry.contextName);
    if (adapterContextKeys.has(key)) continue;
    augmentedAdapterContexts.push({
      contextName: entry.contextName,
      adapters: [
        {
          name: entry.adapterName,
          implements: entry.portName,
          ...COMMAND_ADAPTER,
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
