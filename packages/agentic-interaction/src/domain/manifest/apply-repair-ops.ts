import { normalizeContextName } from "./normalize-draft";

/**
 * Stage-7 structured-edit contract (follow-up C). Instead of asking the reviewer
 * model to re-emit the entire manifest — where it faithfully reproduces ~2k
 * tokens but drops the few small edits the findings call for — it emits a tiny,
 * typed op-list that we apply DETERMINISTICALLY to the already-valid manifest.
 * This removes the whole class of whole-artifact regeneration failures (shape
 * drift, dropped edits) the tolerant rebuild in PR #346 had to absorb.
 *
 * See docs/planning/stage7-repair-rca-and-remediation.md §8.
 */
export type RepairOp =
  | { op: "add-out-port"; context: string; name: string }
  | { op: "add-in-port"; context: string; name: string }
  | { op: "add-adapter"; context: string; name: string }
  | { op: "remove-out-port"; context: string; name: string }
  | { op: "remove-in-port"; context: string; name: string }
  | { op: "remove-adapter"; context: string; name: string }
  | { op: "remove-context"; context: string }
  | { op: "rename-port"; context: string; from: string; to: string }
  | { op: "rename-context"; from: string; to: string };

/** Loose structural view of an assembled manifest — only the slots ops touch. */
interface PortSlots {
  [slot: string]: unknown[] | undefined;
}
interface ManifestContext {
  name?: string;
  short?: string;
  depends_on?: unknown[];
  layers?: {
    application?: { ports?: PortSlots };
    infrastructure?: { adapters?: unknown[] };
  };
}
export interface ManifestObject {
  bounded_contexts?: ManifestContext[];
  context_mappings?: Array<{ upstream?: unknown; downstream?: unknown }>;
}

export interface ApplyOpsResult {
  manifest: ManifestObject;
  applied: number;
  /** Ops we couldn't apply (unknown context, port already present, …) — reported,
   * never silently dropped (same rule as the rebuild's discard reporting). */
  skipped: Array<{ op: RepairOp; reason: string }>;
}

const cleanString = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

/** A port/adapter entry matches `name` when it's that string, or an object whose
 * `name` is that string — generated manifests use either shape, and remove ops
 * must hit both. */
const entryMatchesName = (entry: unknown, name: string): boolean =>
  entry === name ||
  (entry != null &&
    typeof entry === "object" &&
    (entry as { name?: unknown }).name === name);

/** Validate one raw object as a RepairOp; null if it isn't a recognised op. */
function validateOp(item: unknown): RepairOp | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const op = cleanString(o.op);
  switch (op) {
    case "add-out-port":
    case "add-in-port":
    case "add-adapter":
    case "remove-out-port":
    case "remove-in-port":
    case "remove-adapter": {
      const context = cleanString(o.context);
      const name = cleanString(o.name);
      return context && name ? ({ op, context, name } as RepairOp) : null;
    }
    case "remove-context": {
      const context = cleanString(o.context);
      return context ? { op, context } : null;
    }
    case "rename-port": {
      const context = cleanString(o.context);
      const from = cleanString(o.from);
      const to = cleanString(o.to);
      return context && from && to ? { op, context, from, to } : null;
    }
    case "rename-context": {
      const from = cleanString(o.from);
      const to = cleanString(o.to);
      return from && to ? { op, from, to } : null;
    }
    default:
      return null;
  }
}

/**
 * Parse the reviewer model's output into validated ops. Tolerant of a prose
 * preamble or code fences around the JSON array (the model is told to emit only
 * the array, but a stray "Here are the edits:" must not break parsing). Anything
 * that isn't a recognised op is collected in `rejected` for reporting.
 */
/**
 * Every top-level balanced `[...]` span in the text, string-literal-aware (a `]`
 * inside a JSON string doesn't close the span). A naive first-`[`/last-`]` slice
 * swallows the real op-array whenever the model narrates with brackets — and the
 * prompt itself tells it about the `[R01]`/`[R03]` finding tags, so that prose is
 * a likely shape. Scanning all balanced spans lets us pick the array that parses.
 */
export function extractBracketArrays(text: string): string[] {
  const spans: string[] = [];
  let depth = 0;
  let startIdx = -1;
  let inStr = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "[") {
      if (depth === 0) startIdx = i;
      depth++;
    } else if (ch === "]" && depth > 0) {
      depth--;
      if (depth === 0 && startIdx !== -1) {
        spans.push(text.slice(startIdx, i + 1));
        startIdx = -1;
      }
    }
  }
  return spans;
}

export function parseRepairOps(text: string): {
  ops: RepairOp[];
  rejected: unknown[];
} {
  const ops: RepairOp[] = [];
  const rejected: unknown[] = [];
  let sawArray = false;
  for (const span of extractBracketArrays(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(span);
    } catch {
      continue; // not the JSON op-array (e.g. an `[R03]` tag in prose)
    }
    if (!Array.isArray(parsed)) continue;
    sawArray = true;
    for (const item of parsed) {
      const op = validateOp(item);
      if (op) ops.push(op);
      else rejected.push(item);
    }
  }
  if (!sawArray && text.trim().length > 0) {
    rejected.push(text.trim().slice(0, 200));
  }
  return { ops, rejected };
}

/**
 * Apply validated ops to a DEEP COPY of the manifest (the original is the
 * fail-safe and must not be mutated). Returns the edited manifest plus an applied
 * count and a skipped list (unknown context, no-op duplicates, missing rename
 * target). Re-validation + the integrity gate still judge the result downstream.
 */
export function applyManifestOps(
  manifest: ManifestObject,
  ops: RepairOp[],
): ApplyOpsResult {
  const next: ManifestObject = structuredClone(manifest);
  const contexts = Array.isArray(next.bounded_contexts)
    ? next.bounded_contexts
    : [];
  const findCtx = (name: string): ManifestContext | undefined =>
    contexts.find(
      (c) =>
        c != null &&
        normalizeContextName(c.name ?? "") === normalizeContextName(name),
    );

  let applied = 0;
  const skipped: Array<{ op: RepairOp; reason: string }> = [];
  const skip = (op: RepairOp, reason: string) => skipped.push({ op, reason });

  const ensurePortList = (
    ctx: ManifestContext,
    slot: "in" | "out",
  ): unknown[] => {
    const layers = (ctx.layers ??= {});
    const application = (layers.application ??= {});
    const ports = (application.ports ??= {});
    if (!Array.isArray(ports[slot])) ports[slot] = [];
    return ports[slot] as unknown[];
  };
  const ensureAdapterList = (ctx: ManifestContext): unknown[] => {
    const layers = (ctx.layers ??= {});
    const infrastructure = (layers.infrastructure ??= {});
    if (!Array.isArray(infrastructure.adapters)) infrastructure.adapters = [];
    return infrastructure.adapters;
  };

  for (const op of ops) {
    if (op.op === "rename-context") {
      const ctx = findCtx(op.from);
      if (!ctx) {
        skip(op, `context '${op.from}' not found`);
        continue;
      }
      if (findCtx(op.to)) {
        skip(op, `target name '${op.to}' already exists`);
        continue;
      }
      const fromNorm = normalizeContextName(op.from);
      ctx.name = op.to;
      // `short` is an alternate context key (lookupUseCases / known-context
      // filtering); rename it too so it can't dangle on the old name. Assembled
      // manifests omit `short`, so this is a no-op on the prod path — defensive.
      if (ctx.short != null && normalizeContextName(ctx.short) === fromNorm)
        ctx.short = op.to;
      for (const m of Array.isArray(next.context_mappings)
        ? next.context_mappings
        : []) {
        if (m == null) continue;
        if (normalizeContextName(String(m.upstream ?? "")) === fromNorm)
          m.upstream = op.to;
        if (normalizeContextName(String(m.downstream ?? "")) === fromNorm)
          m.downstream = op.to;
      }
      for (const c of contexts) {
        if (Array.isArray(c.depends_on)) {
          c.depends_on = c.depends_on.map((d) =>
            normalizeContextName(String(d)) === fromNorm ? op.to : d,
          );
        }
      }
      applied++;
      continue;
    }

    if (op.op === "remove-context") {
      const idx = contexts.findIndex(
        (c) =>
          c != null &&
          normalizeContextName(c.name ?? "") ===
            normalizeContextName(op.context),
      );
      if (idx === -1) {
        skip(op, `context '${op.context}' not found`);
        continue;
      }
      const removedNorm = normalizeContextName(op.context);
      contexts.splice(idx, 1);
      // Drop mappings that reference the removed context, and prune it from any
      // remaining context's depends_on — leaving them would dangle (R07).
      if (Array.isArray(next.context_mappings)) {
        next.context_mappings = next.context_mappings.filter(
          (m) =>
            m != null &&
            normalizeContextName(String(m.upstream ?? "")) !== removedNorm &&
            normalizeContextName(String(m.downstream ?? "")) !== removedNorm,
        );
      }
      for (const c of contexts) {
        if (Array.isArray(c.depends_on)) {
          c.depends_on = c.depends_on.filter(
            (d) => normalizeContextName(String(d)) !== removedNorm,
          );
        }
      }
      applied++;
      continue;
    }

    const ctx = findCtx(op.context);
    if (!ctx) {
      skip(op, `context '${op.context}' not found`);
      continue;
    }

    if (op.op === "add-out-port" || op.op === "add-in-port") {
      const list = ensurePortList(ctx, op.op === "add-out-port" ? "out" : "in");
      if (list.some((e) => entryMatchesName(e, op.name))) {
        skip(op, `port '${op.name}' already present`);
        continue;
      }
      list.push(op.name);
      applied++;
    } else if (op.op === "add-adapter") {
      const list = ensureAdapterList(ctx);
      if (list.some((e) => entryMatchesName(e, op.name))) {
        skip(op, `adapter '${op.name}' already present`);
        continue;
      }
      list.push(op.name);
      applied++;
    } else if (op.op === "rename-port") {
      if (op.from === op.to) {
        skip(op, "no-op rename (from === to)");
        continue;
      }
      const ports = ctx.layers?.application?.ports;
      // Refuse to rename onto a name already in the context — it would create a
      // duplicate port, which checkDuplicatePortNames flags and which would fail
      // (or be undone by) re-validation, discarding the whole repair. Match both
      // string and `{name}` entry shapes, same as removals.
      const collides = (["in", "out"] as const).some((slot) => {
        const list = ports?.[slot];
        return (
          Array.isArray(list) && list.some((e) => entryMatchesName(e, op.to))
        );
      });
      if (collides) {
        skip(op, `target port '${op.to}' already present`);
        continue;
      }
      let found = false;
      for (const slot of ["in", "out"] as const) {
        const list = ports?.[slot];
        if (Array.isArray(list)) {
          const i = list.findIndex((p) => entryMatchesName(p, op.from));
          if (i !== -1) {
            const cur = list[i];
            // Preserve the entry's shape: rename the `name` of an object entry,
            // or replace a bare string with the new string.
            list[i] =
              cur != null && typeof cur === "object"
                ? { ...(cur as Record<string, unknown>), name: op.to }
                : op.to;
            found = true;
          }
        }
      }
      if (found) applied++;
      else skip(op, `port '${op.from}' not found`);
    } else if (op.op === "remove-in-port" || op.op === "remove-out-port") {
      const slot = op.op === "remove-in-port" ? "in" : "out";
      const ports = ctx.layers?.application?.ports;
      const list = ports?.[slot];
      if (!ports || !Array.isArray(list)) {
        skip(op, `no ${slot} ports on '${op.context}'`);
        continue;
      }
      const kept = list.filter((p) => !entryMatchesName(p, op.name));
      if (kept.length === list.length) {
        skip(op, `port '${op.name}' not found`);
        continue;
      }
      ports[slot] = kept;
      applied++;
    } else if (op.op === "remove-adapter") {
      const infra = ctx.layers?.infrastructure;
      const list = infra?.adapters;
      if (!infra || !Array.isArray(list)) {
        skip(op, `no adapters on '${op.context}'`);
        continue;
      }
      const kept = list.filter((a) => !entryMatchesName(a, op.name));
      if (kept.length === list.length) {
        skip(op, `adapter '${op.name}' not found`);
        continue;
      }
      infra.adapters = kept;
      applied++;
    }
  }

  return { manifest: next, applied, skipped };
}
