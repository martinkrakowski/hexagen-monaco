import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Result } from "@hexagen/shared";
import type { TraceRecord } from "../../application/kernel/trace.js";
import type {
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
 * and file on first write. Append-only: never reads, rewrites, or
 * truncates existing lines (docs/kernel/TRACE.md storage rule). Digests
 * the tool call's raw args/result here — hashing is the one piece of this
 * adapter's job the arch linter treats as I/O, so it stays out of the
 * application-layer use case that calls this port.
 */
export class TraceWriteAdapter implements TraceWritePort {
  constructor(private readonly workspaceRoot: string) {}

  async appendLine(input: TraceAppendInput): Promise<Result<void>> {
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
      await fs.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, EVIDENCE_FILE);
      await fs.appendFile(filePath, `${JSON.stringify(trace)}\n`, "utf-8");
      return { success: true, value: undefined };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}
