import { normalizeContextName } from "./normalize-draft";
import type {
  AdapterBindings,
  ContextPorts,
  PortMap,
} from "../value-objects/pipeline-state";

/**
 * Per-context R04/R05 port→adapter coverage counting.
 *
 * Extracted (behavior-identical) from `structuralManifestErrors` in
 * `execute-structured-config-generation.use-case.ts` so that
 * `execute-validation-review.use-case.ts` can recompute R04/R05
 * deterministically after discarding the judge's findings for those rules.
 * The review use-case cannot import the structured-config use-case back —
 * `execute-structured-config-generation` already imports
 * `execute-validation-review`, so that direction would be an import cycle.
 * Hence this shared domain helper.
 *
 * Scoping contract (the whole point of the extraction): a port is covered by
 * adapters declared in the SAME context's `<adapter_bindings>` entry only. A
 * port name that also appears in another context is a separate port there —
 * cross-context sharing of a port name is the single-ownership advisory's
 * concern (#402), never an R04/R05 violation.
 */

/**
 * contextNorm → portName → number of adapters implementing it.
 *
 * Adapters with an empty `implements` are skipped: an unbound adapter is the
 * *symptom* R04/R05 reports (its port shows 0 adapters), not a countable
 * binding. This preserves the empty-implements skip from
 * `structuralManifestErrors`.
 */
export function buildPortAdapterCounts(
  adapterBindings: AdapterBindings,
): Map<string, Map<string, number>> {
  const portAdapterCount = new Map<string, Map<string, number>>();
  for (const ctxAdapters of adapterBindings.contexts) {
    const ctxNorm = normalizeContextName(ctxAdapters.contextName);
    if (!portAdapterCount.has(ctxNorm))
      portAdapterCount.set(ctxNorm, new Map());
    const countMap = portAdapterCount.get(ctxNorm)!;
    for (const adapter of ctxAdapters.adapters) {
      if (adapter.implements) {
        countMap.set(
          adapter.implements,
          (countMap.get(adapter.implements) ?? 0) + 1,
        );
      }
    }
  }
  return portAdapterCount;
}

/**
 * R04/R05 findings for one context, given that context's own adapter counts.
 * Message format is pinned by the structural-manifest-errors suite — keep it
 * byte-identical with the pre-extraction strings.
 */
export function portCoverageErrorsForContext(
  ctx: ContextPorts,
  countMap: ReadonlyMap<string, number>,
): string[] {
  const errors: string[] = [];
  for (const port of ctx.out) {
    const n = countMap.get(port.name) ?? 0;
    if (n !== 1) {
      errors.push(
        `[R04] Outbound port '${port.name}' in '${ctx.contextName}' has ${n} adapter${n !== 1 ? "s" : ""} (expected 1).`,
      );
    }
  }
  for (const port of ctx.in) {
    const n = countMap.get(port.name) ?? 0;
    if (n !== 1) {
      errors.push(
        `[R05] Inbound port '${port.name}' in '${ctx.contextName}' has ${n} adapter${n !== 1 ? "s" : ""} (expected 1).`,
      );
    }
  }
  return errors;
}

/**
 * Full per-context R04/R05 recompute over a port map + adapter bindings.
 *
 * `sharedKernelNorms` holds normalized context names exempt from coverage
 * (shared-kernels must have no ports at all — that is R09's territory, and
 * counting them here would double-report). Contexts with a non-string
 * `contextName` are skipped, matching `structuralManifestErrors`' fail-safe
 * for malformed/partial state.
 */
export function portAdapterCoverageErrors(
  portMap: PortMap,
  adapterBindings: AdapterBindings,
  sharedKernelNorms: ReadonlySet<string>,
): string[] {
  const counts = buildPortAdapterCounts(adapterBindings);
  const errors: string[] = [];
  for (const ctx of portMap.contexts) {
    if (typeof ctx.contextName !== "string") continue;
    const ctxNorm = normalizeContextName(ctx.contextName);
    if (sharedKernelNorms.has(ctxNorm)) continue;
    errors.push(
      ...portCoverageErrorsForContext(
        ctx,
        counts.get(ctxNorm) ?? new Map<string, number>(),
      ),
    );
  }
  return errors;
}
