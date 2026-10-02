import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Result } from "@hexagen/shared";
import { isRepoMode } from "@hexagen/shared/node/grant-key";
import {
  TraceChainError,
  appendChainedLineLocked,
  inspectTrace,
  withTraceLock,
} from "@hexagen/shared/node/trace-chain";
import type { TraceRecord } from "../../application/kernel/trace.js";
import type {
  GrantMissingAppendInput,
  TraceAppendInput,
  TraceAppendReceipt,
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
 * Two modes, decided per call, under the trace lock. An existing file's last
 * line decides: a chained line means the chain continues, an unchained line
 * means the plain append continues (the file is never converted). Only for a
 * new or empty file does the manifest decide, by the test the grant-key
 * resolver uses (a `.architecture/manifest.yaml` under the workspace root means
 * repo mode). A torn tail refuses only on a chained file (or a lone fragment
 * with no manifest); a plain file's torn tail is appended after exactly as
 * before BW3.
 * - plain (greenfield): today's unchained line, byte for byte; `grant_missing`
 *   is a no-op.
 * - chained (brownfield): lines carry `seq` and `prev_hash`
 *   (docs/kernel/TRACE.md "Chain and tip").
 */
export class TraceWriteAdapter implements TraceWritePort {
  constructor(private readonly workspaceRoot: string) {}

  /**
   * Which format to append. Call only while holding the trace lock, so the
   * choice and the append are one lock hold: a writer that sees a half-written
   * line, or a manifest that flips between two writers, cannot mix formats.
   * The last complete line decides, so a torn tail never changes the format:
   * a chained file stays chained (and the chained writer refuses the torn
   * tail), a plain file stays plain and appends exactly as it always did. A
   * file with no complete line at all is decided by the manifest; if it is
   * only a fragment and there is no manifest, it refuses (in repo mode it keeps
   * the plain behaviour).
   */
  private async isChainedLocked(filePath: string): Promise<boolean> {
    const { mode } = await inspectTrace(filePath);
    if (mode === "chained") return true;
    if (mode === "unchained") return false;
    if (mode === "unknown") {
      if (isRepoMode(this.workspaceRoot)) return false;
      throw new TraceChainError(
        "torn-tail",
        `${filePath} holds only a torn fragment; refusing to append (move it aside or repair it)`,
      );
    }
    return !isRepoMode(this.workspaceRoot);
  }

  async appendLine(
    input: TraceAppendInput,
  ): Promise<Result<TraceAppendReceipt | void, Error>> {
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
      const receipt = await withTraceLock(
        filePath,
        async (): Promise<TraceAppendReceipt> => {
          if (await this.isChainedLocked(filePath)) {
            const appended = await appendChainedLineLocked(
              filePath,
              (next) => ({
                ...trace,
                ...next,
              }),
            );
            return { seq: appended.seq };
          }
          await fs.mkdir(dir, { recursive: true });
          await fs.appendFile(filePath, `${JSON.stringify(trace)}\n`, "utf-8");
          return {};
        },
      );
      return { success: true, value: receipt };
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
    try {
      const filePath = path.join(
        this.workspaceRoot,
        ...EVIDENCE_DIR,
        EVIDENCE_FILE,
      );
      await withTraceLock(filePath, async () => {
        // An unchained trace keeps today's no-op so its file stays byte-identical.
        if (!(await this.isChainedLocked(filePath))) return;
        await appendChainedLineLocked(filePath, (next) => ({
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
      });
      return { success: true, value: undefined };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}
