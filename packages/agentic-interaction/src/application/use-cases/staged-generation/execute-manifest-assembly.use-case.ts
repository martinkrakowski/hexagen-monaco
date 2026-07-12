import {
  normalizeDraft,
  draftToManifest,
  renderManifestYaml,
  toKebabCase,
  normalizeContextName,
} from "../../../domain/index";
import { enforceManifestSchema } from "../../../domain/manifest/enforce-manifest-schema";
import type {
  ManifestDraft,
  ManifestDraftContext,
} from "../../../domain/index";
import type {
  PipelineState,
  AssembledManifest,
  AssemblyWarning,
  DomainAnalysis,
} from "../../../domain/value-objects/pipeline-state";

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
    > & {
      stage1?: DomainAnalysis;
      apps?: unknown[];
    },
  ): AssembledManifest {
    const draftContexts: ManifestDraftContext[] = [];

    const acceptedContexts = state.stage2?.accepted || [];
    const portMap = state.stage3?.contexts || [];
    const adapterBindings = state.stage4?.contexts || [];
    const domainAnalysis = state.stage1;

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

    if (state.apps && state.apps.length > 0) {
      manifestObj.apps = state.apps;
    }

    // Enrich layers.domain with aggregate roots, child entities, and value objects
    // from the DomainAnalysis (stage1) if available (structured config path only).
    if (domainAnalysis) {
      for (const bc of manifestObj.bounded_contexts) {
        const ctxName = bc.name;

        const aggregateNames = (domainAnalysis.aggregateRoots ?? [])
          .filter(
            (ar) =>
              normalizeContextName(ar.subdomain ?? "") ===
              normalizeContextName(ctxName),
          )
          .map((ar) => ar.name);

        const entityNames = (domainAnalysis.entities ?? [])
          .filter(
            (e) =>
              e.subdomain !== undefined &&
              normalizeContextName(e.subdomain) ===
                normalizeContextName(ctxName),
          )
          .map((e) => e.name);

        const voNames = (domainAnalysis.valueObjects ?? [])
          .filter(
            (vo) =>
              vo.subdomain !== undefined &&
              normalizeContextName(vo.subdomain) ===
                normalizeContextName(ctxName),
          )
          .map((vo) => vo.name);

        const allEntities = [...aggregateNames, ...entityNames];

        bc.layers = {
          ...bc.layers,
          domain: {
            ...(bc.layers?.domain ?? {}),
            ...(allEntities.length > 0 ? { entities: allEntities } : {}),
            ...(voNames.length > 0 ? { value_objects: voNames } : {}),
          },
        };
      }
    }

    // Schema gate: the accept screen parses the returned YAML with the STRICT
    // ManifestSchema, and `apps` / `context_mappings` / the domain enrichment
    // above carry LLM-derived values verbatim (loose-spec conversion, Stage-7
    // repair ops). Sanitize BEFORE rendering so yaml and parsedObject agree,
    // and report every change — one bad app entry must not brick the whole
    // manifest at the last click.
    const schemaGate = enforceManifestSchema(manifestObj);

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
      ...(schemaGate.advisories.length > 0
        ? { schemaAdvisories: schemaGate.advisories }
        : {}),
      ...(schemaGate.residualIssues.length > 0
        ? { schemaIssues: schemaGate.residualIssues }
        : {}),
    };
  }
}
