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

function toKebabCase(input: unknown): string {
  const str = typeof input === "string" ? input : String(input ?? "");
  return str
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

function ensurePortSuffix(name: string): string {
  const trimmed = safeTrim(name);
  if (!trimmed) return "UnnamedPort";
  if (trimmed.endsWith("Port")) return trimmed;
  return `${trimmed}Port`;
}

function normalizePortName(name: string): string {
  const trimmed = safeTrim(name);
  if (!trimmed) return "UnnamedPort";
  return ensurePortSuffix(toPascalCase(trimmed));
}

function normalizeContextName(name: string): string {
  return toKebabCase(name);
}

function safeTrim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePort(port: ManifestDraftPort): ManifestDraftPort {
  return {
    name: normalizePortName(safeTrim(port.name)),
    type: safeTrim(port.type),
    description: safeTrim(port.description),
  };
}

function normalizeContext(context: ManifestDraftContext): ManifestDraftContext {
  return {
    name: normalizeContextName(safeTrim(context.name)),
    type: context.type,
    description: safeTrim(context.description),
    ports: {
      in: (context.ports?.in ?? []).map(normalizePort),
      out: (context.ports?.out ?? []).map(normalizePort),
    },
    adapters: (context.adapters ?? []).map((a) => ({
      name: safeTrim(a.name),
      type: safeTrim(a.type),
      implements: normalizePortName(safeTrim(a.implements)),
    })),
    dependsOn: context.dependsOn?.map(toKebabCase),
  };
}

function normalizeTopologyContext(
  context: ManifestTopologyDraftContext,
): ManifestTopologyDraftContext {
  return {
    name: normalizeContextName(safeTrim(context.name)),
    type: context.type,
    description: safeTrim(context.description),
    ports: {
      in: (context.ports?.in ?? []).map(normalizePort),
      out: (context.ports?.out ?? []).map(normalizePort),
    },
    dependsOn: context.dependsOn?.map(toKebabCase),
  };
}

export function normalizeDraft(draft: ManifestDraft): ManifestDraft {
  return {
    workspace: {
      name: safeTrim(draft.workspace.name),
      description: safeTrim(draft.workspace.description),
    },
    boundedContexts: draft.boundedContexts.map(normalizeContext),
  };
}

export function normalizeTopologyDraft(
  draft: ManifestTopologyDraft,
): ManifestTopologyDraft {
  return {
    workspace: {
      name: safeTrim(draft.workspace.name),
      description: safeTrim(draft.workspace.description),
    },
    boundedContexts: draft.boundedContexts.map(normalizeTopologyContext),
  };
}

export { toPascalCase, toKebabCase, ensurePortSuffix, normalizePortName };
