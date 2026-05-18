import {
  normalizeDraft,
  draftToManifest,
  renderManifestYaml,
  toKebabCase,
} from "../../../domain/index.js";
import type {
  ManifestDraft,
  ManifestDraftContext,
} from "../../../domain/index.js";
import type {
  PipelineState,
  AssembledManifest,
  AssemblyWarning,
} from "../../../domain/value-objects/pipeline-state.js";

const STOP_WORDS = new Set([
  "structured",
  "config",
  "with",
  "contexts",
  "a",
  "an",
  "the",
  "system",
  "platform",
  "application",
  "app",
  "service",
  "tool",
  "generate",
  "build",
  "create",
]);

function extractProjectName(intent: string): string {
  const words = intent
    .split(/\s+/)
    .filter((w) => !STOP_WORDS.has(w.toLowerCase()))
    .slice(0, 4)
    .join(" ");
  return words || intent.split(" ").slice(0, 3).join(" ");
}

export class ExecuteManifestAssemblyUseCase {
  execute(
    state: Pick<
      PipelineState,
      "stage0" | "stage2" | "stage3" | "stage4" | "contextMappings"
    >,
  ): AssembledManifest {
    const draftContexts: ManifestDraftContext[] = [];

    const acceptedContexts = state.stage2?.accepted || [];
    const portMap = state.stage3?.contexts || [];
    const adapterBindings = state.stage4?.contexts || [];

    for (const ctx of acceptedContexts) {
      const ctxPorts = portMap.find((p) => p.contextName === ctx.name);
      const ctxAdapters = adapterBindings.find(
        (a) => a.contextName === ctx.name,
      );

      draftContexts.push({
        name: ctx.name,
        type: ctx.type,
        description: ctx.responsibility ?? ctx.reasoning ?? ctx.name,
        ports: {
          in: ctxPorts?.in || [],
          out: ctxPorts?.out || [],
        },
        adapters: ctxAdapters?.adapters || [],
      });
    }

    const intent = state.stage0?.intent || "Generated Workspace";
    const rawName = state.stage0?.projectName ?? extractProjectName(intent);
    const workspaceName = toKebabCase(rawName) || "hexagen-workspace";

    const draft: ManifestDraft = {
      workspace: {
        name: workspaceName,
        description: intent,
      },
      boundedContexts: draftContexts,
      contextMappings: (state.contextMappings ?? []).map((m) => ({
        upstream: m.upstream,
        downstream: m.downstream,
        pattern: m.pattern,
        mechanism: m.mechanism,
        notes: m.notes,
        events: m.events ?? [],
      })),
    };

    const normalized = normalizeDraft(draft);
    const manifestObj = draftToManifest(normalized);
    const manifestYaml = renderManifestYaml(manifestObj);

    const assemblyWarnings: AssemblyWarning[] = [];

    for (const ctx of acceptedContexts) {
      const ctxPorts = portMap.find((p) => p.contextName === ctx.name);
      const ctxAdapters = adapterBindings.find(
        (a) => a.contextName === ctx.name,
      );

      if (
        !ctxPorts ||
        (ctxPorts.in.length === 0 && ctxPorts.out.length === 0)
      ) {
        if (ctx.type !== "shared-kernel") {
          assemblyWarnings.push({
            contextName: ctx.name,
            message: `Context has no ports defined. Stage 3 may have failed to generate ports for this context.`,
            severity: "warning",
          });
        }
      }

      const outPorts = ctxPorts?.out ?? [];
      const adapters = ctxAdapters?.adapters ?? [];
      for (const port of outPorts) {
        const hasAdapter = adapters.some((a) => a.implements === port.name);
        if (!hasAdapter) {
          assemblyWarnings.push({
            contextName: ctx.name,
            message: `Outbound port "${port.name}" has no assigned adapter. Stage 4 may have missed this port.`,
            severity: "warning",
          });
        }
      }
    }

    return {
      yaml: manifestYaml,
      parsedObject: manifestObj as unknown as Record<string, unknown>,
      assemblyWarnings,
    };
  }
}
