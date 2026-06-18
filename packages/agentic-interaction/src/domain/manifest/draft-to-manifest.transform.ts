import type { ManifestDraft } from "./manifest-draft.types";

export interface ManifestContextOutput {
  name: string;
  type: string;
  description: string;
  layers: {
    domain?: Record<string, unknown>;
    application?: {
      ports?: {
        in?: string[];
        out?: string[];
      };
    };
    infrastructure?: {
      adapters?: string[];
    };
  };
  depends_on?: string[];
}

export interface ManifestOutput {
  // Workspace metadata mirroring the manifest schema's `workspace:` block.
  // Optional so existing `ManifestOutput` literals (e.g. render-yaml fixtures)
  // stay valid, but `draftToManifest` always emits it. `system`/`scope` below
  // are name-derived only; this is the sole carrier of the human-readable
  // description, whose loss made the Stage-6 R08 rule fire on every run.
  workspace?: {
    name: string;
    description: string;
  };
  system: string;
  scope: string;
  architecture: string;
  bounded_contexts: ManifestContextOutput[];
  apps: unknown[];
  context_mappings?: Array<{
    upstream: string;
    downstream: string;
    pattern?: string;
    mechanism?: string;
    notes?: string;
  }>;
}

function transformPortNames(ports: { name: string }[]): string[] {
  return ports.map((p) => p.name);
}

function transformContext(
  context: ManifestDraft["boundedContexts"][number],
): ManifestContextOutput {
  const inPorts = transformPortNames(context.ports?.in ?? []);
  const outPorts = transformPortNames(context.ports?.out ?? []);
  const adapterNames = (context.adapters ?? []).map((a) => a.name);

  const bc: ManifestContextOutput = {
    name: context.name,
    type: context.type,
    description: context.description,
    layers: {
      domain: {},
      application: {
        ports: {
          in: inPorts.length > 0 ? inPorts : undefined,
          out: outPorts.length > 0 ? outPorts : undefined,
        },
      },
      infrastructure: {
        adapters: adapterNames.length > 0 ? adapterNames : undefined,
      },
    },
  };

  if (context.dependsOn && context.dependsOn.length > 0) {
    bc.depends_on = context.dependsOn;
  }

  return bc;
}

export function draftToManifest(draft: ManifestDraft): ManifestOutput {
  const system = toKebabCase(draft.workspace.name);
  return {
    // Emitted first so the rendered YAML leads with the `workspace:` block
    // (matching the few-shot canonical shape). `name` reuses the kebab `system`
    // for consistency; `description` is the one field system/scope dropped.
    workspace: {
      name: system,
      description: draft.workspace.description,
    },
    system,
    scope: extractScope(draft.workspace.name),
    architecture: "modular-monolith",
    bounded_contexts: draft.boundedContexts.map(transformContext),
    apps: draft.apps ?? [],
    ...(draft.contextMappings?.length && {
      context_mappings: draft.contextMappings.map((m) => ({
        upstream: m.upstream,
        downstream: m.downstream,
        pattern: m.pattern,
        mechanism: m.mechanism,
        notes: m.notes,
      })),
    }),
  };
}

function toKebabCase(input: string): string {
  return input
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

function extractScope(workspaceName: string): string {
  const kebab = toKebabCase(workspaceName);
  const parts = kebab.split("-");
  return parts.length > 1 ? parts[0] : kebab;
}
