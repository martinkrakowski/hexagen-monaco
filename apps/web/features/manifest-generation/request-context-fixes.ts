import {
  extractBracketArrays,
  type RepairOp,
} from "@hexagen/agentic-interaction";
import type { ContextView } from "./store/useContextChatPanel";

/**
 * A grouped, applyable fix derived from the AI's review of one bounded context:
 * a short label, a one-line rationale, and the deterministic manifest edit-ops
 * that realize it. Only fixes whose ops reference *real* entities on the reviewed
 * context survive validation, so an "Apply" button always does something.
 */
export interface ContextFix {
  id: string;
  label: string;
  rationale: string;
  ops: RepairOp[];
}

const CHAT_ENDPOINT = "/api/llm/chat";
const MODEL_NAME = process.env.NEXT_PUBLIC_LLM_MODEL || "gpt-4o-mini";

const FIX_VOCAB = `Allowed ops (JSON). Reference ONLY entities that exist on the context:
- {"op":"remove-in-port","context":"<ctx>","name":"<PortName>"}
- {"op":"remove-out-port","context":"<ctx>","name":"<PortName>"}
- {"op":"remove-adapter","context":"<ctx>","name":"<AdapterName>"}
- {"op":"add-in-port","context":"<ctx>","name":"<PortName>"}      (name should end with "Port")
- {"op":"add-out-port","context":"<ctx>","name":"<PortName>"}
- {"op":"add-adapter","context":"<ctx>","name":"<AdapterName>"}   (name should end with "Adapter")
- {"op":"rename-port","context":"<ctx>","from":"<OldPort>","to":"<NewPort>"}`;

const names = (xs: ReadonlyArray<{ name: string }>): string =>
  xs.length ? xs.map((x) => x.name).join(", ") : "(none)";

/** Single grounded user turn (folded, like useGovernanceChat) asking for ops. */
function buildFixPrompt(ctx: ContextView): string {
  return `You are a hexagonal-architecture governance fixer for HexaGen Monaco. The user reviewed the bounded context below and wants to apply concrete fixes to the generated manifest.

Context "${ctx.name}" (type: ${ctx.type}):
  Description: ${ctx.description}
  Inbound ports: ${names(ctx.portsIn)}
  Outbound ports: ${names(ctx.portsOut)}
  Adapters: ${names(ctx.adapters)}

${FIX_VOCAB}

Return ONLY a JSON array of fixes — no prose, no markdown fences. Each fix is:
{"label":"<short imperative label>","rationale":"<one sentence>","ops":[<one or more ops>]}
Group related edits into ONE fix (e.g. making a type-only shared-kernel pure = remove ALL its ports and adapters in a single fix). Use "${ctx.name}" as the context in every op, and reference only the entities listed above. If there is no safe concrete edit, return [].`;
}

/** Accumulate the route's `data: {type:"chunk",content}` SSE frames into text. */
async function collectStreamedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let buffer = "";
  let out = "";
  const handle = (line: string): boolean => {
    const t = line.trim();
    if (!t.startsWith("data: ")) return false;
    try {
      const frame = JSON.parse(t.slice(6)) as {
        type?: string;
        content?: string;
      };
      if (frame.type === "chunk" && frame.content) out += frame.content;
      return frame.type === "done" || frame.type === "error";
    } catch {
      return false;
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    let terminal = false;
    for (const line of lines) if (handle(line)) terminal = true;
    if (terminal) break;
  }
  for (const line of (buffer + decoder.decode()).split("\n")) handle(line);
  return out;
}

const isStr = (v: unknown): v is string =>
  typeof v === "string" && v.length > 0;

/** Coerce one raw object into a RepairOp from the offered vocabulary, or null. */
function coerceOp(raw: unknown): RepairOp | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const op = o.op;
  const context = typeof o.context === "string" ? o.context.trim() : "";
  const name = typeof o.name === "string" ? o.name.trim() : "";
  switch (op) {
    case "remove-in-port":
    case "remove-out-port":
    case "remove-adapter":
    case "add-in-port":
    case "add-out-port":
    case "add-adapter":
      return context && name ? ({ op, context, name } as RepairOp) : null;
    case "rename-port": {
      const from = typeof o.from === "string" ? o.from.trim() : "";
      const to = typeof o.to === "string" ? o.to.trim() : "";
      return context && from && to ? { op, context, from, to } : null;
    }
    default:
      return null;
  }
}

/** True only when the op would actually change `ctx`: a remove/rename must hit a
 * real entity, and an add must target a name that isn't already there. Drops
 * hallucinated *and* no-op suggestions before a button shows, so "Apply" always
 * does something. */
function isApplicable(op: RepairOp, ctx: ContextView): boolean {
  const has = (xs: ReadonlyArray<{ name: string }>, n: string) =>
    xs.some((x) => x.name === n);
  switch (op.op) {
    case "remove-in-port":
      return op.context === ctx.name && has(ctx.portsIn, op.name);
    case "remove-out-port":
      return op.context === ctx.name && has(ctx.portsOut, op.name);
    case "remove-adapter":
      return op.context === ctx.name && has(ctx.adapters, op.name);
    case "add-in-port":
      return op.context === ctx.name && !has(ctx.portsIn, op.name);
    case "add-out-port":
      return op.context === ctx.name && !has(ctx.portsOut, op.name);
    case "add-adapter":
      return op.context === ctx.name && !has(ctx.adapters, op.name);
    case "rename-port":
      return (
        op.context === ctx.name &&
        (has(ctx.portsIn, op.from) || has(ctx.portsOut, op.from))
      );
    // remove-context / rename-context are intentionally NOT offered here: this is
    // a per-context "fix what's wrong inside this context" flow, not architecture
    // restructuring (that's the separate modify-architecture use-case). They stay
    // in the engine's RepairOp vocabulary for the server-side Stage-7 repairer.
    default:
      return false;
  }
}

/** Validate the elements of one parsed `[...]` span into applyable fixes. */
function buildFixes(parsed: unknown[], ctx: ContextView): ContextFix[] {
  const fixes: ContextFix[] = [];
  parsed.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") return;
    const f = raw as Record<string, unknown>;
    if (!isStr(f.label) || !Array.isArray(f.ops)) return;
    const ops = f.ops
      .map(coerceOp)
      .filter((op): op is RepairOp => op !== null && isApplicable(op, ctx));
    if (ops.length === 0) return;
    fixes.push({
      id: `fix-${i}`,
      label: f.label.trim(),
      rationale: isStr(f.rationale) ? f.rationale.trim() : "",
      ops,
    });
  });
  return fixes;
}

export function parseAndValidateFixes(
  text: string,
  ctx: ContextView,
): ContextFix[] {
  // The model is told to emit only the array, but it can wrap it in prose/fences
  // and the prompt itself names `[Rxx]` finding tags — a naive first-`[`/last-`]`
  // slice swallows those. Scan every balanced top-level span (string-literal
  // aware, shared with the engine's parseRepairOps) and take the first that
  // parses to an array yielding at least one applyable fix.
  for (const span of extractBracketArrays(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(span);
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    const fixes = buildFixes(parsed, ctx);
    if (fixes.length > 0) return fixes;
  }
  return [];
}

/** Run the structured fix-extraction call for one context. Returns validated,
 * applyable fixes (empty on any error — the feature is purely additive). */
export async function requestContextFixes(
  ctx: ContextView,
  signal?: AbortSignal,
): Promise<ContextFix[]> {
  const response = await fetch(CHAT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: buildFixPrompt(ctx) }],
      model: MODEL_NAME,
      temperature: 0.2,
      maxTokens: 1024,
    }),
    signal,
  });
  if (!response.ok) return [];
  const text = await collectStreamedText(response);
  return parseAndValidateFixes(text, ctx);
}
