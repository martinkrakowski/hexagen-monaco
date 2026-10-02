import {
  GENESIS_PREV_HASH,
  lineHash,
  type SplitLine,
} from "@hexagen/shared/node/trace-chain";
import {
  traceRuleReasons,
  type Grant,
  type TraceRuleLine,
} from "@hexagen/shared";

/**
 * Reader-side checks for `hexagen evidence pack`: chain, line shape and the
 * Rules of docs/kernel/TRACE.md. Pure; no fs.
 *
 * The Rule 1-3 logic itself is `traceRuleReasons` in `@hexagen/shared`, the same
 * function the MCP server's `checkTrace` calls: a denial skips the allowlist and
 * window checks, but still has to cite a known grant.
 */

export type LineKind = "evidence" | "denial" | "invalid";

export interface LineVerdict {
  /** 0-based position in the file (equals `seq` on a sound chain). */
  readonly index: number;
  readonly seq?: number;
  readonly kind: LineKind;
  readonly valid: boolean;
  readonly reasons: readonly string[];
  /** The grant a line cites, when it cites one. */
  readonly grantId?: string;
  readonly haltReason?: string;
  readonly tool?: string;
  readonly time?: string;
  readonly reason?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function str(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function millis(iso: string): number | null {
  const m = Date.parse(iso);
  return Number.isNaN(m) ? null : m;
}

function chainReasons(
  line: SplitLine,
  previous: SplitLine | undefined,
): string[] {
  const value = line.value;
  if (!isObject(value)) return ["line is not a JSON object"];
  const { seq, prev_hash } = value;
  if (seq === undefined && prev_hash === undefined) {
    return ["line is not chained (no seq or prev_hash)"];
  }
  const reasons: string[] = [];
  if (typeof seq !== "number" || !Number.isInteger(seq)) {
    reasons.push("seq is not an integer");
  } else if (seq !== line.index) {
    reasons.push(`seq ${seq} does not match position ${line.index}`);
  }
  if (typeof prev_hash !== "string" || !/^[0-9a-f]{64}$/.test(prev_hash)) {
    reasons.push("prev_hash is not 64 lowercase hex characters");
  } else {
    const expected =
      previous === undefined
        ? GENESIS_PREV_HASH
        : previous.value === undefined
          ? undefined
          : lineHash(previous.value);
    if (expected === undefined) {
      reasons.push("the previous line is not valid JSON");
    } else if (prev_hash !== expected) {
      reasons.push(
        previous === undefined
          ? "first line does not start at genesis"
          : "prev_hash does not match the previous line",
      );
    }
  }
  return reasons;
}

function evidenceShapeReasons(value: Record<string, unknown>): string[] {
  const reasons: string[] = [];
  for (const f of ["grant_id", "goal_id", "halt_reason"] as const) {
    if (!str(value[f])) reasons.push(`${f} is missing`);
  }
  for (const f of ["started_at", "ended_at"] as const) {
    if (!str(value[f]) || millis(value[f] as string) === null) {
      reasons.push(`${f} is not an ISO timestamp`);
    }
  }
  if (!Array.isArray(value.transaction_ids)) {
    reasons.push("transaction_ids is not an array");
  } else {
    value.transaction_ids.forEach((id, i) => {
      if (!str(id))
        reasons.push(`transaction_ids[${i}] is not a non-empty string`);
    });
  }
  const calls = value.tool_calls;
  if (!Array.isArray(calls)) {
    reasons.push("tool_calls is not an array");
  } else {
    calls.forEach((c, i) => {
      if (
        !isObject(c) ||
        !str(c.name) ||
        !str(c.args_digest) ||
        !str(c.result_digest) ||
        !str(c.time) ||
        millis(c.time) === null
      ) {
        reasons.push(`tool_calls[${i}] is malformed`);
      }
    });
  }
  return reasons;
}

function ruleReasons(
  value: Record<string, unknown>,
  grants: ReadonlyMap<string, Grant>,
): string[] {
  return traceRuleReasons(value as unknown as TraceRuleLine, [
    ...grants.values(),
  ]);
}

/**
 * One verdict per line, in file order. `grants` holds only grants whose
 * signature verified, so a line citing a forged grant fails Rule 3.
 */
export function checkLines(
  lines: readonly SplitLine[],
  grants: ReadonlyMap<string, Grant>,
): LineVerdict[] {
  return lines.map((line, i) => {
    const previous = i === 0 ? undefined : lines[i - 1];
    const value = line.value;
    if (line.parseError !== undefined || !isObject(value)) {
      return {
        index: line.index,
        kind: "invalid",
        valid: false,
        reasons: [
          line.parseError !== undefined
            ? `not valid JSON (${line.parseError})`
            : "line is not a JSON object",
        ],
      };
    }
    const seq = typeof value.seq === "number" ? value.seq : undefined;
    const base = { index: line.index, ...(seq === undefined ? {} : { seq }) };
    const reasons = chainReasons(line, previous);

    if (value.kind !== undefined) {
      if (value.kind !== "grant_missing") {
        return {
          ...base,
          kind: "invalid",
          valid: false,
          reasons: [...reasons, `unknown record kind '${String(value.kind)}'`],
        };
      }
      if (!str(value.tool)) reasons.push("tool is missing");
      if (!str(value.reason)) reasons.push("reason is missing");
      if (!str(value.time) || millis(value.time) === null) {
        reasons.push("time is not an ISO timestamp");
      }
      if (value.grant_id !== undefined) {
        reasons.push("a grant_missing record must not carry a grant_id");
      }
      return {
        ...base,
        kind: "denial",
        valid: reasons.length === 0,
        reasons,
        haltReason: "grant_missing",
        ...(str(value.tool) ? { tool: value.tool } : {}),
        ...(str(value.time) ? { time: value.time } : {}),
        ...(str(value.reason) ? { reason: value.reason } : {}),
      };
    }

    const shape = evidenceShapeReasons(value);
    reasons.push(...shape);
    const haltReason = str(value.halt_reason) ? value.halt_reason : undefined;
    const denial = haltReason !== undefined && haltReason !== "completed";
    if (shape.length === 0) reasons.push(...ruleReasons(value, grants));
    const first = Array.isArray(value.tool_calls)
      ? (value.tool_calls[0] as Record<string, unknown> | undefined)
      : undefined;
    return {
      ...base,
      kind: denial ? "denial" : "evidence",
      valid: reasons.length === 0,
      reasons,
      ...(str(value.grant_id) ? { grantId: value.grant_id } : {}),
      ...(haltReason === undefined ? {} : { haltReason }),
      ...(first !== undefined && str(first.name) ? { tool: first.name } : {}),
      ...(first !== undefined && str(first.time) ? { time: first.time } : {}),
    };
  });
}
