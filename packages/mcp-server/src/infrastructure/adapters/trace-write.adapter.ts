import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Result } from "@hexagen/shared";
import { isRepoMode } from "@hexagen/shared/node/grant-key";
import { appendChainedLine } from "@hexagen/shared/node/trace-chain";
import type { TraceRecord } from "../../application/kernel/trace.js";
import type {
  GrantMissingAppendInput,
  TraceAppendInput,
  TraceWritePort,
} from "../../application/ports/out/trace-write.port.js";

const EVIDENCE_DIR = [".hexagen", "evidence"];
const EVIDENCE_FILE = "trace.jsonl";

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

/**
 * Appends one JSON line per accept/grant-deny to
 * `<workspaceRoot>/.hexagen/evidence/trace.jsonl`, creating the directory
 * and file on first write. Append-only: never rewrites or truncates
 * existing lines (docs/kernel/TRACE.md storage rule). Digests
 * the tool call's raw args/result here — hashing is the one piece of this
 * adapter's job the arch linter treats as I/O, so it stays out of the
 * application-layer use case that calls this port.
 *
 * Two modes, decided per call by the same test the grant-key resolver uses
 * (a `.architecture/manifest.yaml` under the workspace root means repo mode):
 * - repo mode (greenfield): today's plain, unchained append, byte for byte;
 *   it never reads the file, and `grant_missing` is a no-op.
 * - no manifest (brownfield): lines carry `seq` and `prev_hash`, appended
 *   under a file lock (docs/kernel/TRACE.md "Chain and tip"). An existing
 *   unchained file is refused, never read as a chain or rewritten.
 */
export class TraceWriteAdapter implements TraceWritePort {
  constructor(private readonly workspaceRoot: string) {}

  async appendLine(input: TraceAppendInput): Promise<Result<void, Error>> {
    try {
      const trace: TraceRecord = {
        grant_id: input.grant_id,
        goal_id: input.goal_id,
        tool_calls: [
          {
            name: input.tool_call.name,
            args_digest: digest(input.tool_call.args),
            result_digest: digest(input.tool_call.result),
            time: input.tool_call.time,
          },
        ],
        halt_reason: input.halt_reason,
        transaction_ids: input.transaction_ids,
        started_at: input.started_at,
        ended_at: input.ended_at,
      };

      const dir = path.join(this.workspaceRoot, ...EVIDENCE_DIR);
      const filePath = path.join(dir, EVIDENCE_FILE);
      if (!isRepoMode(this.workspaceRoot)) {
        await appendChainedLine(filePath, (next) => ({ ...trace, ...next }));
        return { success: true, value: undefined };
      }
      await fs.mkdir(dir, { recursive: true });
      await fs.appendFile(filePath, `${JSON.stringify(trace)}\n`, "utf-8");
      return { success: true, value: undefined };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  async appendGrantMissing(
    input: GrantMissingAppendInput,
  ): Promise<Result<void, Error>> {
    // Greenfield keeps today's no-op so its trace file stays byte-identical.
    if (isRepoMode(this.workspaceRoot)) {
      return { success: true, value: undefined };
    }
    try {
      const filePath = path.join(
        this.workspaceRoot,
        ...EVIDENCE_DIR,
        EVIDENCE_FILE,
      );
      await appendChainedLine(filePath, (next) => ({
        kind: "grant_missing",
        ...next,
        ...(input.goal_id === undefined ? {} : { goal_id: input.goal_id }),
        tool: input.tool,
        ...(input.args === undefined
          ? {}
          : { args_digest: digest(input.args) }),
        reason: input.reason,
        time: input.time,
      }));
      return { success: true, value: undefined };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}
