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

/** Validate one raw object as a RepairOp; null if it isn't a recognised op. */
function validateOp(item: unknown): RepairOp | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const op = cleanString(o.op);
  switch (op) {
    case "add-out-port":
    case "add-in-port":
    case "add-adapter": {
      const context = cleanString(o.context);
      const name = cleanString(o.name);
      return context && name ? ({ op, context, name } as RepairOp) : null;
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
export function parseRepairOps(text: string): {
  ops: RepairOp[];
  rejected: unknown[];
} {
  const ops: RepairOp[] = [];
  const rejected: unknown[] = [];
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) {
    return { ops, rejected: text.trim() ? [text.trim().slice(0, 200)] : [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { ops, rejected: [text.slice(start, end + 1).slice(0, 200)] };
  }
  if (!Array.isArray(parsed)) return { ops, rejected: [parsed] };
  for (const item of parsed) {
    const op = validateOp(item);
    if (op) ops.push(op);
    else rejected.push(item);
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

    const ctx = findCtx(op.context);
    if (!ctx) {
      skip(op, `context '${op.context}' not found`);
      continue;
    }

    if (op.op === "add-out-port" || op.op === "add-in-port") {
      const list = ensurePortList(ctx, op.op === "add-out-port" ? "out" : "in");
      if (list.includes(op.name)) {
        skip(op, `port '${op.name}' already present`);
        continue;
      }
      list.push(op.name);
      applied++;
    } else if (op.op === "add-adapter") {
      const list = ensureAdapterList(ctx);
      if (list.includes(op.name)) {
        skip(op, `adapter '${op.name}' already present`);
        continue;
      }
      list.push(op.name);
      applied++;
    } else if (op.op === "rename-port") {
      const ports = ctx.layers?.application?.ports;
      let found = false;
      for (const slot of ["in", "out"] as const) {
        const list = ports?.[slot];
        if (Array.isArray(list)) {
          const i = list.findIndex((p) => p === op.from);
          if (i !== -1) {
            list[i] = op.to;
            found = true;
          }
        }
      }
      if (found) applied++;
      else skip(op, `port '${op.from}' not found`);
    }
  }

  return { manifest: next, applied, skipped };
}
