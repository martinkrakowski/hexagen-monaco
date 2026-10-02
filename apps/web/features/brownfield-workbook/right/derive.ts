import { z } from "zod";
import { ProposalMeta, type Grant, type Slice } from "@hexagen/shared";
import type { LoadedBundle } from "../bundle/read-bundle";
import {
  decodeProposal,
  PROPOSAL_DISPLAY_CAP_BYTES,
  PROPOSAL_TOTAL_BUDGET_BYTES,
  type DecodedProposal,
} from "./proposal-text";

export { PROPOSAL_TOTAL_BUDGET_BYTES };

/**
 * Everything the right panel shows, derived from the bundle alone. Pure: no
 * clock, no network. Expiry is judged against the bundle's own creation time,
 * never `Date.now()`: an old bundle must not silently turn "valid" into
 * "expired" (or the reverse) because the viewer opened it later.
 */

export const DENIAL_CODES = [
  "grant_denied",
  "grant_expired",
  "grant_revoked",
  "grant_missing",
] as const;
export type DenialCode = (typeof DENIAL_CODES)[number];

/**
 * The authorization fields follow the shared `Grant` type exactly (docs/kernel/grant.schema.json).
 * `expires_at` and `revoked_at` are read loosely on purpose: a missing or
 * unreadable one is shown as such (`checkGrantWindow` denies both), not hidden.
 */
const GrantDoc = z.object({
  id: z.string().min(1),
  principal: z.string().min(1),
  agent: z.string().min(1),
  contexts: z.array(z.string().min(1)).optional(),
  paths: z.array(z.string().min(1)),
  tools: z.array(z.string().min(1)),
  mode: z.enum(["write", "propose"]),
  max_files: z.number().int().min(1).optional(),
  expires_at: z.unknown().optional(),
  revoked_at: z.unknown().optional(),
});

// Compile-time guard: the schema may not drift looser than the shared Grant.
type AuthFields = "id" | "principal" | "agent" | "paths" | "tools" | "mode";
const _grantShape: Pick<Grant, AuthFields> = {} as Pick<
  z.infer<typeof GrantDoc>,
  AuthFields
>;
void _grantShape;

export interface GrantView {
  readonly file: string;
  readonly id: string;
  readonly principal: string;
  readonly agent: string;
  readonly mode: "write" | "propose";
  readonly tools: readonly string[];
  readonly paths: readonly string[];
  readonly maxFiles: number | null;
  /** `expires_at` is missing or not a timestamp: such a grant is denied (fail closed). */
  readonly expiryUnreadable: boolean;
  /** `revoked_at` is present but not a timestamp: `checkGrantWindow` denies such a grant. */
  readonly revocationUnreadable: boolean;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  /** Strictly before the bundle's time (a call exactly at `expires_at` is still in-window). */
  readonly expiredAtBundle: boolean;
  /** At or before the bundle's time (revocation is immediate). */
  readonly revokedAtBundle: boolean;
}

export interface ProposalView {
  readonly path: string;
  readonly id: string;
  readonly meta: ProposalMeta | null;
  readonly decoded: DecodedProposal;
  readonly lines: readonly {
    readonly text: string;
    readonly kind: "add" | "del" | "ctx";
  }[];
}

export interface DenialView {
  readonly seq: number;
  readonly code: DenialCode;
  readonly tool: string | null;
  /** The line's own time (`tool_calls[0].time`, or `time` on a grant_missing record). */
  readonly time: string | null;
  /** Only a grant_missing record carries a reason; the other denial lines do not. */
  readonly reason: string | null;
}

export interface RightPanelView {
  /** The bundle's creation time: the clock every expiry here is judged by. */
  readonly bundleTime: string;
  readonly slice: Pick<Slice, "id" | "paths" | "excludes"> | null;
  readonly grants: readonly GrantView[];
  readonly unreadableGrants: readonly string[];
  readonly activeGrantId: string | null;
  readonly activeNote: string | null;
  readonly proposals: readonly ProposalView[];
  readonly denials: readonly DenialView[];
  /** Lines with a halt_reason that is neither "completed" nor a denial code (e.g. "error"). */
  readonly otherHaltLines: number;
  /** Proposal entries the panel cannot show (no matching .patch, or an odd path). */
  readonly proposalsNotShown: readonly string[];
  /** Proposals past the total display budget: listed by path, never decoded. */
  readonly proposalsOverBudget: readonly {
    readonly path: string;
    readonly id: string;
    readonly totalBytes: number;
  }[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

function traceRecords(
  trace: string | null,
): { seq: number; value: Record<string, unknown> }[] {
  if (trace === null) return [];
  const lines = (trace.endsWith("\n") ? trace.slice(0, -1) : trace).split("\n");
  const out: { seq: number; value: Record<string, unknown> }[] = [];
  lines.forEach((text, index) => {
    try {
      const value: unknown = JSON.parse(text);
      if (!isRecord(value)) return;
      // The pack numbers a line by its index in the file, whatever its own `seq` says.
      out.push({ seq: index, value });
    } catch {
      // An unreadable line is the pack's to report, not the panel's.
    }
  });
  return out;
}

function grantView(
  file: string,
  doc: z.infer<typeof GrantDoc>,
  bundleMs: number,
): GrantView {
  const expiresAt = typeof doc.expires_at === "string" ? doc.expires_at : null;
  const revokedAt = typeof doc.revoked_at === "string" ? doc.revoked_at : null;
  const expires = expiresAt === null ? Number.NaN : Date.parse(expiresAt);
  const revoked = revokedAt === null ? Number.NaN : Date.parse(revokedAt);
  return {
    file,
    id: doc.id,
    principal: doc.principal,
    agent: doc.agent,
    mode: doc.mode,
    tools: doc.tools,
    paths: doc.paths,
    maxFiles: doc.max_files ?? null,
    expiryUnreadable: Number.isNaN(expires),
    revocationUnreadable: doc.revoked_at !== undefined && Number.isNaN(revoked),
    expiresAt,
    revokedAt,
    expiredAtBundle: expires < bundleMs,
    revokedAtBundle: revoked <= bundleMs,
  };
}

function lineKind(text: string): "add" | "del" | "ctx" {
  if (text.startsWith("+") && !text.startsWith("+++")) return "add";
  if (text.startsWith("-") && !text.startsWith("---")) return "del";
  return "ctx";
}

const PATCH_PATH = /^proposals\/([^/]+)\.patch$/;

function proposals(b: LoadedBundle): {
  shown: ProposalView[];
  notShown: string[];
  overBudget: { path: string; id: string; totalBytes: number }[];
} {
  const overBudget: { path: string; id: string; totalBytes: number }[] = [];
  let budget = PROPOSAL_TOTAL_BUDGET_BYTES;
  const strict = new TextDecoder("utf-8", { fatal: true });
  const shown: ProposalView[] = [];
  const used = new Set<string>();
  for (const path of b.proposals) {
    const m = PATCH_PATH.exec(path);
    const bytes = b.proposalFiles.get(path);
    if (m === null || bytes === undefined) continue;
    const id = m[1] as string;
    used.add(path);
    used.add(`proposals/${id}.json`);
    // Decided from the byte length alone: a skipped proposal is never decoded.
    const cost = Math.min(bytes.length, PROPOSAL_DISPLAY_CAP_BYTES);
    if (cost > budget) {
      overBudget.push({ path, id, totalBytes: bytes.length });
      continue;
    }
    budget -= cost;
    let meta: ProposalMeta | null = null;
    const metaPath = `proposals/${id}.json`;
    const metaBytes = b.proposalFiles.get(metaPath);
    if (metaBytes !== undefined) {
      used.add(metaPath);
      try {
        const parsed = ProposalMeta.safeParse(
          JSON.parse(strict.decode(metaBytes)),
        );
        meta = parsed.success ? parsed.data : null;
      } catch {
        meta = null;
      }
    }
    const decoded = decodeProposal(bytes);
    shown.push({
      path,
      id,
      meta,
      decoded,
      lines: decoded.text
        .split("\n")
        .map((text) => ({ text, kind: lineKind(text) })),
    });
  }
  return {
    shown,
    overBudget,
    notShown: b.proposals.filter((p) => !used.has(p)),
  };
}

export function deriveRightPanel(b: LoadedBundle): RightPanelView {
  const bundleMs = Date.parse(b.index.createdAt);
  const grants: GrantView[] = [];
  const unreadableGrants: string[] = [];
  for (const g of b.grants) {
    try {
      grants.push(
        grantView(g.path, GrantDoc.parse(JSON.parse(g.text)), bundleMs),
      );
    } catch {
      unreadableGrants.push(g.path);
    }
  }

  const records = traceRecords(b.trace);
  const denials: DenialView[] = [];
  let otherHaltLines = 0;
  // The latest line that names a grant decides. If that grant is not bundled
  // the answer is "unknown": never walk back to an older line.
  let latestGrantId: string | null = null;
  for (let i = records.length - 1; i >= 0 && latestGrantId === null; i -= 1) {
    latestGrantId = str(
      (records[i] as { value: Record<string, unknown> }).value.grant_id,
    );
  }
  const activeGrantId =
    latestGrantId !== null && grants.some((g) => g.id === latestGrantId)
      ? latestGrantId
      : null;
  for (const { seq, value } of records) {
    if (value.kind === "grant_missing") {
      denials.push({
        seq,
        code: "grant_missing",
        tool: str(value.tool),
        time: str(value.time),
        reason: str(value.reason),
      });
      continue;
    }
    const code = DENIAL_CODES.find(
      (c) => c !== "grant_missing" && c === value.halt_reason,
    );
    if (code === undefined) {
      const halt = str(value.halt_reason);
      if (halt !== null && halt !== "completed") otherHaltLines += 1;
      continue;
    }
    const first = Array.isArray(value.tool_calls)
      ? value.tool_calls[0]
      : undefined;
    denials.push({
      seq,
      code,
      tool: isRecord(first) ? str(first.name) : null,
      time: isRecord(first) ? str(first.time) : null,
      reason: null,
    });
  }

  const shownProposals = proposals(b);
  return {
    bundleTime: b.index.createdAt,
    slice:
      b.slice === null
        ? null
        : { id: b.slice.id, paths: b.slice.paths, excludes: b.slice.excludes },
    grants,
    unreadableGrants,
    activeGrantId,
    activeNote:
      activeGrantId === null && grants.length > 0
        ? "Cannot tell which grant is active: the latest trace line that names a grant does not name one in this bundle. All grants are listed."
        : null,
    proposals: shownProposals.shown,
    proposalsNotShown: shownProposals.notShown,
    proposalsOverBudget: shownProposals.overBudget,
    denials,
    otherHaltLines,
  };
}
