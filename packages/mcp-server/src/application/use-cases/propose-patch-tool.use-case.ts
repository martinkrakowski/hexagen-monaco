import { isPathInSlice, type ProposalMeta } from "@hexagen/shared";
import {
  checkGrantWindow,
  type GrantCheck,
  type GrantDenialCode,
} from "../kernel/grant.js";
import { checkWriteAgainstGrant } from "../kernel/write-grant.js";
import { checkGrantSignature } from "../kernel/grant-verification.js";
import { parseUnifiedDiff } from "../kernel/patch.js";
import type {
  ProposePatchToolInput,
  ProposePatchToolPort,
  ProposePatchToolResult,
} from "../ports/in/propose-patch-tool.port.js";
import type { GrantSignaturePort } from "../ports/out/grant-signature.port.js";
import type { ProposalWorkspacePort } from "../ports/out/proposal-workspace.port.js";
import type {
  TraceAppendReceipt,
  TraceWritePort,
} from "../ports/out/trace-write.port.js";

export const PROPOSE_PATCH_TOOL = "hexagen_propose_patch";

const RESERVED_ROOTS: ReadonlySet<string> = new Set([".hexagen", ".git"]);

/**
 * ProposePatchToolUseCase: `hexagen_propose_patch`, propose-only (plan BW-D9).
 *
 * Takes a unified diff and a signed Grant, decides whether the Grant and the
 * slice both allow every path the diff touches, writes one trace line either
 * way, and stores an allowed patch under `.hexagen/proposals/`. It never
 * applies the patch and never writes anywhere in the working tree; the FDE
 * applies it with `git apply -p1`.
 *
 * Checks, in order, each denying before the next runs:
 * 1. the grant has an `id` (otherwise a `grant_missing` record);
 * 2. `checkGrantSignature`, then `checkGrantWindow`;
 * 3. the diff parses strictly (symlinks, submodules, binary, odd paths refused);
 * 4. `checkWriteAgainstGrant` for every touched path;
 * 5. the slice: every path inside `slice.paths` and outside `excludes`; a
 *    missing slice denies, and a grant wider than the slice is still bounded;
 * 6. the on-disk spelling: each path is resolved through the real directories
 *    and must stay under the repo and under a granted prefix, and the slice
 *    check runs again on that spelling, so a case- or normalisation-insensitive
 *    filesystem cannot reach an excluded path by spelling it differently.
 *
 * `checkGrantMode` is deliberately never run: propose-only grants carry mode
 * "propose" and the mode check would deny every patch.
 */
export class ProposePatchToolUseCase implements ProposePatchToolPort {
  constructor(
    private readonly workspace: ProposalWorkspacePort,
    private readonly traceWritePort: TraceWritePort,
    private readonly grantSignaturePort: GrantSignaturePort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(input: ProposePatchToolInput): Promise<ProposePatchToolResult> {
    const sliceResult = await this.workspace.readSlice();
    const slice = sliceResult.success ? sliceResult.value : undefined;
    // The slice id names the cycle; without a slice the caller's id, else a fixed word.
    const goalId = slice?.id ?? input.goal_id ?? "no-slice";

    // Only a non-empty string can be cited in a trace line.
    const rawId: unknown = input.grant?.id;
    const citedId =
      typeof rawId === "string" && rawId.length > 0 ? rawId : undefined;
    const deny = (code: GrantDenialCode, reason: string) =>
      this.deny(input, citedId, goalId, code, reason);

    const grant = input.grant;
    if (grant === undefined || citedId === undefined) {
      return deny(
        "grant_denied",
        grant === undefined ? "No Grant supplied" : "Grant has no id",
      );
    }

    const signatureCheck = await checkGrantSignature(
      grant,
      this.grantSignaturePort,
    );
    if (!signatureCheck.allowed) {
      return deny(signatureCheck.code, signatureCheck.reason);
    }
    const verified = signatureCheck.grant;

    const windowCheck = checkGrantWindow(verified, this.now());
    if (!windowCheck.allowed) return deny(windowCheck.code, windowCheck.reason);

    const parsed = parseUnifiedDiff(input.patch);
    if (!parsed.ok)
      return deny("grant_denied", `Patch refused: ${parsed.reason}`);
    const paths = parsed.paths;

    // The sidecar and git's own directory are never a proposal's business.
    // First-segment, case-sensitive; the on-disk re-check covers case tricks.
    const reserved = paths.find((p) =>
      RESERVED_ROOTS.has(p.split("/")[0] ?? ""),
    );
    if (reserved !== undefined) {
      return deny(
        "grant_denied",
        `Path '${reserved}' is refused: .hexagen/ and .git/ are never proposed`,
      );
    }

    const grantCheck = checkWriteAgainstGrant(verified, {
      tool: PROPOSE_PATCH_TOOL,
      paths,
    });
    if (!grantCheck.allowed) return deny(grantCheck.code, grantCheck.reason);

    if (slice === undefined) {
      const why = sliceResult.success ? "" : `: ${sliceResult.error.message}`;
      return deny(
        "grant_denied",
        `No usable .hexagen/slice.json; the slice bounds every proposal${why}`,
      );
    }
    for (const p of paths) {
      if (!isPathInSlice(slice, p)) {
        return deny("grant_denied", `Path '${p}' is outside the slice`);
      }
    }

    const resolved = await this.workspace.resolveOnDisk(paths);
    if (!resolved.success) {
      return deny(
        "grant_denied",
        `Could not resolve the on-disk paths: ${resolved.error.message}`,
      );
    }
    const reals: string[] = [];
    for (const entry of resolved.value) {
      if ("problem" in entry) {
        return deny(
          "grant_denied",
          `Path '${entry.path}' refused on disk: ${entry.problem}`,
        );
      }
      reals.push(entry.real);
    }
    const realGrant: GrantCheck = checkWriteAgainstGrant(verified, {
      tool: PROPOSE_PATCH_TOOL,
      paths: reals,
    });
    if (!realGrant.allowed) {
      return deny(realGrant.code, `On-disk spelling: ${realGrant.reason}`);
    }
    for (const real of reals) {
      if (!isPathInSlice(slice, real)) {
        return deny(
          "grant_denied",
          `On-disk path '${real}' is outside the slice`,
        );
      }
    }

    return this.store(input, verified.id, slice.id, goalId, paths);
  }

  private async store(
    input: ProposePatchToolInput,
    grantId: string,
    sliceId: string,
    goalId: string,
    paths: readonly string[],
  ): Promise<ProposePatchToolResult> {
    const saved = await this.workspace.savePatch(input.patch);
    if (!saved.success) {
      return this.failed(`could not store the patch: ${saved.error.message}`);
    }
    const id = saved.value.id;
    const time = this.now().toISOString();
    const traced = await this.traceWritePort.appendLine({
      grant_id: grantId,
      goal_id: goalId,
      tool_call: {
        name: PROPOSE_PATCH_TOOL,
        args: { patch: input.patch },
        result: { halt_reason: "completed", proposal_id: id, paths },
        time,
      },
      halt_reason: "completed",
      transaction_ids: [],
      started_at: time,
      ended_at: time,
    });
    if (!traced.success) {
      await this.workspace.discardPatch(id);
      return this.failed(
        `trace evidence could not be written, so nothing was proposed: ${traced.error.message}`,
      );
    }
    // An unchained (greenfield) trace has no sequence numbers.
    const traceSeq = (traced.value as TraceAppendReceipt | undefined)?.seq ?? 0;
    const meta: ProposalMeta = {
      id,
      grantId,
      sliceId,
      tool: PROPOSE_PATCH_TOOL,
      paths: [...paths],
      traceSeq,
      createdAt: time,
    };
    const metaSaved = await this.workspace.saveMeta(meta);
    if (!metaSaved.success) {
      await this.workspace.discardPatch(id);
      const reason = `could not store the proposal metadata: ${metaSaved.error.message}`;
      await this.compensate(grantId, goalId, id, reason);
      return this.failed(reason);
    }
    return {
      allowed: true,
      proposal_id: id,
      patch_file: `.hexagen/proposals/${id}.patch`,
      meta_file: `.hexagen/proposals/${id}.json`,
      paths,
      trace_seq: traceSeq,
      apply_with: `git apply -p1 .hexagen/proposals/${id}.patch`,
    };
  }

  /**
   * The `completed` line already cites a proposal that was then discarded.
   * Best effort: append an `error` line saying so; a failure here is ignored
   * (the call is already reporting an error).
   */
  private async compensate(
    grantId: string,
    goalId: string,
    proposalId: string,
    reason: string,
  ): Promise<void> {
    const time = this.now().toISOString();
    await this.traceWritePort
      .appendLine({
        grant_id: grantId,
        goal_id: goalId,
        tool_call: {
          name: PROPOSE_PATCH_TOOL,
          args: { proposal_id: proposalId },
          result: { proposal_id: proposalId, discarded: true, reason },
          time,
        },
        halt_reason: "error",
        transaction_ids: [],
        started_at: time,
        ended_at: time,
      })
      .catch(() => undefined);
  }

  private failed(reason: string): ProposePatchToolResult {
    return { allowed: false, code: "error", reason };
  }

  /**
   * Every denial writes its evidence: a `grant_missing` record when there is no
   * grant id to cite, otherwise a trace line whose halt_reason is the code.
   */
  private async deny(
    input: ProposePatchToolInput,
    grantId: string | undefined,
    goalId: string,
    code: GrantDenialCode,
    reason: string,
  ): Promise<ProposePatchToolResult> {
    const time = this.now().toISOString();
    const args = { patch: input.patch };
    const traced = grantId
      ? await this.traceWritePort.appendLine({
          grant_id: grantId,
          goal_id: goalId,
          tool_call: {
            name: PROPOSE_PATCH_TOOL,
            args,
            result: { halt_reason: code, reason },
            time,
          },
          halt_reason: code,
          transaction_ids: [],
          started_at: time,
          ended_at: time,
        })
      : await this.traceWritePort.appendGrantMissing({
          tool: PROPOSE_PATCH_TOOL,
          args,
          goal_id: goalId,
          reason,
          time,
        });
    return {
      allowed: false,
      code: grantId ? code : "grant_missing",
      reason,
      ...(traced.success ? {} : { trace_write_error: traced.error.message }),
    };
  }
}
