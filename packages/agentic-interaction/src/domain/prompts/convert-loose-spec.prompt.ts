import { MAX_RETRY_ATTEMPTS } from "../errors/stage-errors";
import { escapeXml } from "./escape-xml";

export const LOOSE_SPEC_CONVERSION_SYSTEM_PROMPT = `You are a requirements architect. Your job is to convert a loose, semi-structured project specification into a strict JSON configuration matching the StructuredConfig schema.

CRITICAL OUTPUT FORMAT — JSON ONLY.
Output ONLY a single valid JSON object. No prose. No markdown. No code fences.

CRITICAL DATA FIDELITY RULES:
1. Preserve EVERY field present in the source. Do not summarise. Do not drop values.
2. If a field cannot be cleanly mapped to a schema slot, place it in the nearest valid field and add a "notes" qualifier explaining the deviation.
3. If a structural concept is named in the source but its details are missing (e.g. "Payment aggregate" with no fields), still emit the named entity with empty children.
4. Preserve casing of proper nouns (context names, aggregate names). Normalise field-key style to snake_case.

TARGET SCHEMA — the JSON MUST match this TypeScript interface:

interface StructuredConfigField {
  name: string;
  type: string;
  key?: boolean;
  nullable?: boolean;
  private?: boolean;
  admin_only?: boolean;
  collection?: boolean;
  ref?: string;
  derived?: string;
}

interface StructuredConfigAggregate {
  name: string;
  root?: boolean;          // true = aggregate root; false = child entity
  parent?: string;         // child entity's parent aggregate name
  fields?: StructuredConfigField[];
}

interface StructuredConfigValueObject {
  name: string;
  underlying?: string;     // e.g. "enum", "string", "number"
  immutable?: boolean;
  generated?: boolean;
  rules?: string[];
  values?: string[];       // for enums
  fields?: StructuredConfigField[];
  prefix?: string;
  pattern?: string;
}

interface StructuredConfigUseCase {
  name: string;
  command?: string;
  actor?: string | string[];
}

interface StructuredConfigContextMapping {
  upstream: string;
  downstream: string;
  pattern?: string;        // e.g. "OHS_ACL", "OH", "ACL", "Conformist"
  mechanism?: string;      // e.g. "webhook", "event", "api"
  notes?: string;
  shared?: string[];
  events?: string[];
  coupling?: string;
}

interface StructuredConfigEventBusSubscription {
  event: string;
  handler?: string;
  consumers?: string[];
}

interface StructuredConfigApp {
  name: string;
  framework?: string;
  version?: string;
  role?: string;
  deployment?: string;
  responsibilities?: string[];
  ui?: { library?: string; styling?: string };
  auth?: string;
  schedule?: string;
}

interface StructuredConfigContext {
  name: string;
  short?: string;
  responsibility?: string;
  description?: string;
  app?: string;            // name of the app this context lives in
  aggregates?: StructuredConfigAggregate[];
  value_objects?: StructuredConfigValueObject[];
  events_published?: string[];
  events_consumed?: Array<{ event: string; notify?: string; channels?: string[] }>;
  type?: "core" | "supporting" | "generic" | "shared-kernel" | "driver";
}

interface StructuredConfig {
  project?: string;
  version?: string;
  organization?: string;
  apps?: StructuredConfigApp[];
  bounded_contexts: StructuredConfigContext[];          // REQUIRED, non-empty
  use_cases?: Record<string, StructuredConfigUseCase[]>; // keyed by context name
  context_mappings?: StructuredConfigContextMapping[];
  event_bus?: {
    envelope?: Record<string, string>;
    subscriptions?: StructuredConfigEventBusSubscription[];
  };
}

EXTRACTION GUIDANCE:
- Bounded contexts are usually headed by "## SomeName", "### SomeName Context", or named in prose.
- Aggregates often appear under a context as "- AggregateName" or "**AggregateName** (Root)".
- Value objects often appear under headings like "Value Objects" or "VO:".
- Context mappings often appear as "Upstream -> Downstream (Pattern: X, Mechanism: Y)".
- Use cases often appear under "Use Cases" headings as verb-first names.
- App-level info (framework, deployment, auth) belongs in the apps[] array.

Output ONLY the JSON object. Begin with "{" and end with "}".`;

export function compileLooseSpecConversionPrompt(
  userDescription: string,
): string {
  return `Convert this loose specification to the required JSON. Preserve every field.\n<user_input>\n${escapeXml(userDescription)}\n</user_input>\n\nOutput JSON:`;
}

export interface LooseSpecRetryContext {
  attempt: number;
  failedOutput: string;
  errorDetail: string;
  originalPrompt: string;
}

export function buildLooseSpecRetryPrompt(ctx: LooseSpecRetryContext): string {
  const truncatedOutput =
    ctx.failedOutput.length > 800
      ? ctx.failedOutput.slice(0, 800) + "\n... [truncated]"
      : ctx.failedOutput;

  return [
    `CORRECTION REQUIRED — Attempt ${ctx.attempt} of ${MAX_RETRY_ATTEMPTS}`,
    ``,
    `Your previous output was rejected for this reason:`,
    `<rejection_reason>`,
    ctx.errorDetail,
    `</rejection_reason>`,
    ``,
    `Your previous output was:`,
    `<failed_output>`,
    truncatedOutput,
    `</failed_output>`,
    ``,
    `The original input that produced this output was:`,
    `<original_input>`,
    ctx.originalPrompt.slice(0, 1000),
    `</original_input>`,
    ``,
    `Format reminder: Output ONLY valid JSON containing a non-empty "bounded_contexts" array.`,
    `Preserve every field from the source. Do not drop data to make the JSON shorter.`,
    ``,
    `Correct ONLY the invalid portions. Output corrected JSON:`,
  ].join("\n");
}
