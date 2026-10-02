import { z } from "zod";
import { ProposalMeta, type Slice } from "@hexagen/shared";
import type { LoadedBundle } from "../bundle/read-bundle";
import { decodeProposal, type DecodedProposal } from "./proposal-text";

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

const GrantDoc = z.object({
  id: z.string().min(1),
  principal: z.string().nullish(),
  agent: z.string().nullish(),
  contexts: z.array(z.string()).nullish(),
  paths: z.array(z.string()).nullish(),
  tools: z.array(z.string()).nullish(),
  mode: z.string().nullish(),
  max_files: z.number().nullish(),
  expires_at: z.string().nullish(),
  revoked_at: z.string().nullish(),
});

export interface GrantView {
  readonly file: string;
  readonly id: string;
  readonly principal: string | null;
  readonly agent: string | null;
  readonly mode: string | null;
  readonly tools: readonly string[];
  readonly paths: readonly string[];
  readonly maxFiles: number | null;
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
  /** The reason as recorded (the pack's verdict, or the line's own `reason`). */
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
      out.push({
        seq: typeof value.seq === "number" ? value.seq : index,
        value,
      });
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
  const expires =
    doc.expires_at == null ? Number.NaN : Date.parse(doc.expires_at);
  const revoked =
    doc.revoked_at == null ? Number.NaN : Date.parse(doc.revoked_at);
  return {
    file,
    id: doc.id,
    principal: doc.principal ?? null,
    agent: doc.agent ?? null,
    mode: doc.mode ?? null,
    tools: doc.tools ?? [],
    paths: doc.paths ?? [],
    maxFiles: doc.max_files ?? null,
    expiresAt: doc.expires_at ?? null,
    revokedAt: doc.revoked_at ?? null,
    expiredAtBundle: expires < bundleMs,
    revokedAtBundle: revoked <= bundleMs,
  };
}

function lineKind(text: string): "add" | "del" | "ctx" {
  if (text.startsWith("+") && !text.startsWith("+++")) return "add";
  if (text.startsWith("-") && !text.startsWith("---")) return "del";
  return "ctx";
}

function proposals(b: LoadedBundle): ProposalView[] {
  const strict = new TextDecoder("utf-8", { fatal: true });
  const out: ProposalView[] = [];
  for (const path of b.proposals) {
    const m = /^proposals\/(.+)\.patch$/.exec(path);
    const bytes = b.proposalFiles.get(path);
    if (m === null || bytes === undefined) continue;
    const id = m[1] as string;
    let meta: ProposalMeta | null = null;
    const metaBytes = b.proposalFiles.get(`proposals/${id}.json`);
    if (metaBytes !== undefined) {
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
    out.push({
      path,
      id,
      meta,
      decoded,
      lines: decoded.text
        .split("\n")
        .map((text) => ({ text, kind: lineKind(text) })),
    });
  }
  return out;
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
  const verdicts = b.verdicts !== "invalid" ? b.verdicts : null;
  const reasonBySeq = new Map(
    (verdicts?.denials ?? []).map((d) => [d.seq, d.reason ?? null] as const),
  );

  const denials: DenialView[] = [];
  let activeGrantId: string | null = null;
  for (let i = records.length - 1; i >= 0 && activeGrantId === null; i -= 1) {
    const id = str(
      (records[i] as { value: Record<string, unknown> }).value.grant_id,
    );
    if (id !== null && grants.some((g) => g.id === id)) activeGrantId = id;
  }
  for (const { seq, value } of records) {
    if (value.kind === "grant_missing") {
      denials.push({
        seq,
        code: "grant_missing",
        tool: str(value.tool),
        reason: str(value.reason),
      });
      continue;
    }
    const code = DENIAL_CODES.find(
      (c) => c !== "grant_missing" && c === value.halt_reason,
    );
    if (code === undefined) continue;
    const first = Array.isArray(value.tool_calls)
      ? value.tool_calls[0]
      : undefined;
    denials.push({
      seq,
      code,
      tool: isRecord(first) ? str(first.name) : null,
      reason: reasonBySeq.get(seq) ?? null,
    });
  }

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
        ? "Cannot tell which grant is active: no trace line cites a grant in this bundle. All grants are listed."
        : null,
    proposals: proposals(b),
    denials,
  };
}
