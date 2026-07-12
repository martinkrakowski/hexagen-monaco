import type {
  ManifestDraft,
  ManifestDraftContext,
  ManifestDraftPort,
  ManifestTopologyDraft,
  ManifestTopologyDraftContext,
} from "./manifest-draft.types";

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

export function normalizeContextName(name: string): string {
  // safeTrim (not name.trim()) so a non-string from a partial LLM object
  // (e.g. an undefined context_mappings.upstream) coerces to "" instead of
  // throwing — matches normalizePortName's defensiveness.
  return (
    safeTrim(name)
      // Acronym boundary FIRST (IAMService → IAM-Service, APIGateway →
      // API-Gateway): the camel rule below only fires on lower→UPPER, so a run
      // of capitals would otherwise collapse (IAMService → "iamservice") and
      // diverge from the kebab the assembler and Stage 2 emit ("iam-service").
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .toLowerCase()
  );
}

/**
 * Resolve a model-emitted context name to the accepted spelling — stage LLMs
 * emit casing/kebab variants of the names they were given (documented prod
 * incident, 2026-06-18 nemotron run). Returns undefined when nothing matches
 * so callers can drop hallucinated references (Stage-3 context mappings).
 */
export function matchAcceptedContextName(
  inputName: string,
  acceptedNames: Iterable<string>,
): string | undefined {
  const normalized = normalizeContextName(inputName);
  for (const name of acceptedNames) {
    if (normalizeContextName(name) === normalized) return name;
  }
  return undefined;
}

/**
 * `matchAcceptedContextName` with keep-the-input fallback — for call sites
 * that must retain unmatched entries (the orchestrator's echo filter decides
 * their fate, disclosed) rather than drop them.
 */
export function canonicalContextName(
  inputName: string,
  acceptedNames: Iterable<string>,
): string {
  return matchAcceptedContextName(inputName, acceptedNames) ?? inputName;
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
    ...(draft.contextMappings && {
      contextMappings: draft.contextMappings.map((m) => ({
        upstream: normalizeContextName(m.upstream),
        downstream: normalizeContextName(m.downstream),
        pattern: m.pattern,
        mechanism: m.mechanism,
        notes: m.notes,
      })),
    }),
    ...(draft.apps && { apps: draft.apps }),
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
