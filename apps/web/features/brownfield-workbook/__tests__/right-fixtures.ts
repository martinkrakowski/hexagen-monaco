import { buildBundle, validFiles, type FixtureFile } from "./bundle-fixtures";
import { readBundle, type LoadedBundle } from "../bundle/read-bundle";

/** Synthetic fixtures for the right panel. The bundle is created at BUNDLE_TIME. */

export const BUNDLE_TIME = "2026-10-01T10:00:00.000Z";
const ZERO = "0".repeat(64);

export function grantDoc(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: "g1",
    principal: "fde-alice",
    agent: "agent-7",
    contexts: [],
    paths: ["core/"],
    tools: ["hexagen_propose_patch"],
    mode: "propose",
    expires_at: "2026-10-01T12:00:00.000Z",
    ...over,
  });
}

export function traceLine(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    grant_id: "g1",
    goal_id: "slice-1",
    tool_calls: [
      {
        name: "hexagen_propose_patch",
        args_digest: "sha256:aa",
        result_digest: "sha256:bb",
        time: BUNDLE_TIME,
      },
    ],
    halt_reason: "completed",
    transaction_ids: [],
    started_at: BUNDLE_TIME,
    ended_at: BUNDLE_TIME,
    seq: 0,
    prev_hash: ZERO,
    ...over,
  });
}

export const missingLine = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    kind: "grant_missing",
    seq: 0,
    prev_hash: ZERO,
    tool: "hexagen_propose_patch",
    reason: "no grant supplied",
    time: BUNDLE_TIME,
    ...over,
  });

export const proposalMeta = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    id: "p1",
    grantId: "g1",
    sliceId: "slice-1",
    tool: "hexagen_propose_patch",
    paths: ["core/a.ts"],
    traceSeq: 0,
    createdAt: BUNDLE_TIME,
    ...over,
  });

export const PATCH = [
  "diff --git a/core/a.ts b/core/a.ts",
  "--- a/core/a.ts",
  "+++ b/core/a.ts",
  "@@ -1,2 +1,2 @@",
  "-const a = 1;",
  "+const a = 2;",
  " const b = 3;",
  "",
].join("\n");

export interface Spec {
  readonly grants?: readonly string[];
  readonly trace?: readonly string[];
  readonly verdictDenials?: readonly Record<string, unknown>[];
  readonly proposals?: readonly FixtureFile[];
}

export function files(spec: Spec = {}): FixtureFile[] {
  const base = validFiles().filter(
    (f) => f.role !== "grant" && f.path !== "evidence/trace.jsonl",
  );
  const withVerdicts = base.map((f) =>
    f.path === "evidence/verdicts.json" && spec.verdictDenials !== undefined
      ? {
          ...f,
          content: JSON.stringify({
            ...JSON.parse(String(f.content)),
            denials: spec.verdictDenials,
          }),
        }
      : f,
  );
  return [
    ...withVerdicts,
    ...(spec.grants ?? [grantDoc()]).map((g, i) => ({
      path: `grants/${i}-g.json`,
      role: "grant",
      content: g,
    })),
    {
      path: "evidence/trace.jsonl",
      role: "evidence",
      content: `${(spec.trace ?? [traceLine()]).join("\n")}\n`,
    },
    ...(spec.proposals ?? []),
  ];
}

export async function loadFiles(list: FixtureFile[]): Promise<LoadedBundle> {
  const r = await readBundle(await buildBundle(list));
  if (!r.ok) throw new Error(r.errors.join("; "));
  return r.bundle;
}

export const loadSpec = (spec: Spec = {}): Promise<LoadedBundle> =>
  loadFiles(files(spec));
