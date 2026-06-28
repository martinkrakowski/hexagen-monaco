import type { ContextView } from "./store/useContextChatPanel";

/**
 * Governance persona for the context Q&A. Self-contained (not imported from the
 * governance-assistant feature) to respect the feature-isolation lint rule —
 * features may not import each other; shared chat plumbing would be the trigger
 * for a shared module once a third consumer needs it.
 */
const GOVERNANCE_PERSONA =
  "You are a hexagonal-architecture governance expert embedded in HexaGen Monaco. " +
  "Answer concisely and specifically in English. Focus on bounded-context design, " +
  "port/adapter correctness, and dependency boundaries. Be concrete and actionable.";

export interface ContextQuestion {
  /** Grounding system prompt: the governance persona + this context's shape. */
  systemPrompt: string;
  /** The question auto-sent when the context is first opened. */
  seedQuestion: string;
}

/** Compact, LLM-readable summary of a single bounded context. */
function serializeContext(ctx: ContextView): string {
  const portsIn = ctx.portsIn.length
    ? ctx.portsIn
        .map((p) => `    - ${p.name}${p.hasIssue ? " (ISSUE)" : ""}`)
        .join("\n")
    : "    (none)";
  const portsOut = ctx.portsOut.length
    ? ctx.portsOut
        .map((p) => `    - ${p.name}${p.hasIssue ? " (ISSUE)" : ""}`)
        .join("\n")
    : "    (none)";
  const adapters = ctx.adapters.length
    ? ctx.adapters
        .map(
          (a) =>
            `    - ${a.name}${a.implements ? ` implements ${a.implements}` : ""}`,
        )
        .join("\n")
    : "    (none)";
  const reasons = ctx.healthReasons.length
    ? `\n  Health notes: ${ctx.healthReasons.join("; ")}`
    : "";

  return [
    `  Name: ${ctx.name}`,
    `  Type: ${ctx.type}`,
    `  Description: ${ctx.description}`,
    `  Health: ${ctx.health}${reasons}`,
    `  Inbound ports:\n${portsIn}`,
    `  Outbound ports:\n${portsOut}`,
    `  Adapters:\n${adapters}`,
  ].join("\n");
}

/**
 * Build the grounded prompt + seed question the governance chat drawer sends
 * when a user clicks a bounded-context card on the accept view. The system
 * prompt layers the context's shape onto the governance persona so answers are
 * specific to that context.
 */
export function buildContextQuestion(ctx: ContextView): ContextQuestion {
  const systemPrompt = `${GOVERNANCE_PERSONA}

The user is reviewing one bounded context from their generated hexagonal
architecture. Answer specifically about THIS context:

${serializeContext(ctx)}`;

  const seedQuestion = `Review the "${ctx.name}" bounded context. Is it well-designed for hexagonal architecture? Flag any governance concerns with its ports, adapters, or boundaries, and suggest concrete improvements.`;

  return { systemPrompt, seedQuestion };
}
