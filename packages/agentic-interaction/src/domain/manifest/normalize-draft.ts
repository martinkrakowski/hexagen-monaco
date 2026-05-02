import type {
  ManifestDraft,
  ManifestDraftContext,
  ManifestDraftPort,
  ManifestTopologyDraft,
  ManifestTopologyDraftContext,
} from "./manifest-draft.types.js";

function toPascalCase(input: string): string {
  return input
    .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""))
    .replace(/^(.)/, (_, c) => c.toUpperCase());
}

function toKebabCase(input: string): string {
  return input
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

function ensurePortSuffix(name: string): string {
  const trimmed = name.trim();
  if (trimmed.endsWith("Port")) return trimmed;
  return `${trimmed}Port`;
}

function normalizePortName(name: string): string {
  const trimmed = name.trim();
  return ensurePortSuffix(toPascalCase(trimmed));
}

function normalizeContextName(name: string): string {
  return toKebabCase(name);
}

function normalizePort(port: ManifestDraftPort): ManifestDraftPort {
  return {
    name: normalizePortName(port.name),
    type: port.type.trim(),
    description: port.description.trim(),
  };
}

function normalizeContext(context: ManifestDraftContext): ManifestDraftContext {
  return {
    name: normalizeContextName(context.name),
    type: context.type,
    description: context.description.trim(),
    ports: {
      in: context.ports.in.map(normalizePort),
      out: context.ports.out.map(normalizePort),
    },
    adapters: context.adapters.map((a) => ({
      name: a.name.trim(),
      type: a.type.trim(),
      implements: normalizePortName(a.implements),
    })),
    dependsOn: context.dependsOn?.map(toKebabCase),
  };
}

function normalizeTopologyContext(
  context: ManifestTopologyDraftContext,
): ManifestTopologyDraftContext {
  return {
    name: normalizeContextName(context.name),
    type: context.type,
    description: context.description.trim(),
    ports: {
      in: context.ports.in.map(normalizePort),
      out: context.ports.out.map(normalizePort),
    },
    dependsOn: context.dependsOn?.map(toKebabCase),
  };
}

export function normalizeDraft(draft: ManifestDraft): ManifestDraft {
  return {
    workspace: {
      name: draft.workspace.name.trim(),
      description: draft.workspace.description.trim(),
    },
    boundedContexts: draft.boundedContexts.map(normalizeContext),
  };
}

export function normalizeTopologyDraft(
  draft: ManifestTopologyDraft,
): ManifestTopologyDraft {
  return {
    workspace: {
      name: draft.workspace.name.trim(),
      description: draft.workspace.description.trim(),
    },
    boundedContexts: draft.boundedContexts.map(normalizeTopologyContext),
  };
}

export { toPascalCase, toKebabCase, ensurePortSuffix, normalizePortName };
