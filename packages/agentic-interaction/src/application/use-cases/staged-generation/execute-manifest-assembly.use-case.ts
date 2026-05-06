import {
  normalizeDraft,
  draftToManifest,
  renderManifestYaml,
  toKebabCase,
} from "../../../domain/index.js";
import type { ManifestDraft, ManifestDraftContext } from "../../../domain/index.js";
import type {
  PipelineState,
  AssembledManifest,
} from "../../../domain/value-objects/pipeline-state.js";

export class ExecuteManifestAssemblyUseCase {
  execute(
    state: Pick<PipelineState, "stage0" | "stage2" | "stage3" | "stage4">,
  ): AssembledManifest {
    const draftContexts: ManifestDraftContext[] = [];

    const acceptedContexts = state.stage2?.accepted || [];
    const portMap = state.stage3?.contexts || [];
    const adapterBindings = state.stage4?.contexts || [];

    for (const ctx of acceptedContexts) {
      const ctxPorts = portMap.find((p) => p.contextName === ctx.name);
      const ctxAdapters = adapterBindings.find((a) => a.contextName === ctx.name);

      draftContexts.push({
        name: ctx.name,
        type: ctx.type,
        description: ctx.reasoning || ctx.name,
        ports: {
          in: ctxPorts?.in || [],
          out: ctxPorts?.out || [],
        },
        adapters: ctxAdapters?.adapters || [],
      });
    }

    const intent = state.stage0?.intent || "Generated Workspace";
    const workspaceName =
      toKebabCase(intent.split(" ").slice(0, 4).join(" ")) || "hexagen-workspace";

    const draft: ManifestDraft = {
      workspace: {
        name: workspaceName,
        description: intent,
      },
      boundedContexts: draftContexts,
    };

    const normalized = normalizeDraft(draft);
    const manifestObj = draftToManifest(normalized);
    const manifestYaml = renderManifestYaml(manifestObj);

    return {
      yaml: manifestYaml,
      parsedObject: manifestObj as unknown as Record<string, unknown>,
    };
  }
}
