import type { ManifestDraft } from "./manifest-draft.types.js";

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
  system: string;
  scope: string;
  architecture: string;
  bounded_contexts: ManifestContextOutput[];
  apps: unknown[];
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
  return {
    system: toKebabCase(draft.workspace.name),
    scope: extractScope(draft.workspace.name),
    architecture: "modular-monolith",
    bounded_contexts: draft.boundedContexts.map(transformContext),
    apps: [],
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
