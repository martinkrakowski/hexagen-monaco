import type {
  ManifestDraft,
  ManifestDraftContext,
  DraftDiagnostic,
  DraftValidationResult,
  ClarificationTrigger,
  ManifestTopologyDraft,
} from "./manifest-draft.types.js";
import { GENERIC_CONTEXT_NAMES } from "./manifest-draft.schema.js";

function diag(code: string, message: string, path?: string): DraftDiagnostic {
  return { code, message, path };
}

function checkDuplicateContextNames(
  contexts: readonly { name: string }[],
): DraftDiagnostic[] {
  const diagnostics: DraftDiagnostic[] = [];
  const seen = new Set<string>();
  for (const ctx of contexts) {
    if (seen.has(ctx.name)) {
      diagnostics.push(
        diag(
          "duplicate-context-name",
          `Duplicate bounded context name: "${ctx.name}"`,
          `boundedContexts[${ctx.name}]`,
        ),
      );
    }
    seen.add(ctx.name);
  }
  return diagnostics;
}

function checkDuplicatePortNames(
  context: ManifestDraftContext,
): DraftDiagnostic[] {
  const diagnostics: DraftDiagnostic[] = [];
  const allPortNames = [
    ...context.ports.in.map((p) => p.name),
    ...context.ports.out.map((p) => p.name),
  ];
  const seen = new Set<string>();
  for (const name of allPortNames) {
    if (seen.has(name)) {
      diagnostics.push(
        diag(
          "duplicate-port-name",
          `Duplicate port name "${name}" in context "${context.name}"`,
          `boundedContexts[${context.name}].ports`,
        ),
      );
    }
    seen.add(name);
  }
  return diagnostics;
}

function checkAdapterReferences(
  context: ManifestDraftContext,
): DraftDiagnostic[] {
  const diagnostics: DraftDiagnostic[] = [];
  const validPortNames = new Set([
    ...context.ports.in.map((p) => p.name),
    ...context.ports.out.map((p) => p.name),
  ]);
  for (const adapter of context.adapters) {
    if (!validPortNames.has(adapter.implements)) {
      diagnostics.push(
        diag(
          "adapter-references-missing-port",
          `Adapter "${adapter.name}" implements "${adapter.implements}" which does not exist in context "${context.name}"`,
          `boundedContexts[${context.name}].adapters[${adapter.name}]`,
        ),
      );
    }
  }
  return diagnostics;
}

function checkDependsOnReferences(
  context: ManifestDraftContext,
  allContextNames: ReadonlySet<string>,
): DraftDiagnostic[] {
  const diagnostics: DraftDiagnostic[] = [];
  for (const dep of context.dependsOn ?? []) {
    if (dep === context.name) {
      diagnostics.push(
        diag(
          "self-referential-depends-on",
          `Context "${context.name}" depends on itself`,
          `boundedContexts[${context.name}].dependsOn`,
        ),
      );
    } else if (!allContextNames.has(dep)) {
      diagnostics.push(
        diag(
          "depends-on-unknown-context",
          `Context "${context.name}" depends on unknown context "${dep}"`,
          `boundedContexts[${context.name}].dependsOn`,
        ),
      );
    }
  }
  return diagnostics;
}

export function validateDraft(draft: ManifestDraft): DraftValidationResult {
  const diagnostics: DraftDiagnostic[] = [];
  const contextNames = new Set(draft.boundedContexts.map((c) => c.name));

  diagnostics.push(...checkDuplicateContextNames(draft.boundedContexts));

  for (const context of draft.boundedContexts) {
    diagnostics.push(...checkDuplicatePortNames(context));
    diagnostics.push(...checkAdapterReferences(context));
    diagnostics.push(...checkDependsOnReferences(context, contextNames));
  }

  return {
    valid: diagnostics.length === 0,
    diagnostics,
  };
}

export function checkClarificationTriggers(
  draft: ManifestTopologyDraft,
): ClarificationTrigger[] {
  const triggers: ClarificationTrigger[] = [];

  const totalInboundPorts = draft.boundedContexts.reduce(
    (sum, ctx) => sum + ctx.ports.in.length,
    0,
  );
  if (totalInboundPorts === 0) {
    triggers.push({
      type: "no-inbound-ports",
      message:
        "No inbound ports found across any context. At least one inbound port is required for a usable architecture.",
    });
  }

  if (draft.boundedContexts.length === 1) {
    const ctx = draft.boundedContexts[0];
    if (ctx.ports.out.length === 0) {
      // Advisory only — surface as warning, do not block the pipeline
      triggers.push({
        type: "single-context-no-outbound",
        contextName: ctx.name,
        message: `The only context "${ctx.name}" has no outbound ports. This may indicate missing infrastructure dependencies. Consider adding outbound ports for repositories, external APIs, or queues.`,
      });
    }
  }

  for (const ctx of draft.boundedContexts) {
    if (
      (GENERIC_CONTEXT_NAMES as readonly string[]).includes(
        ctx.name.toLowerCase(),
      )
    ) {
      triggers.push({
        type: "generic-context-name",
        contextName: ctx.name,
        message: `Context name "${ctx.name}" is too generic. Please provide a domain-specific name (e.g., "order-management" instead of "core").`,
      });
    }
  }

  return triggers;
}
