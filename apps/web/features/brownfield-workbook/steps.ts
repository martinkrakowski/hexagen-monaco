import { edgesComplete } from "@hexagen/shared";
import type { LoadedBundle } from "./bundle/read-bundle";
import type { PackVerdicts } from "./bundle/verdicts";

/**
 * The six steps of the left rail. Status comes from the bundle only: nothing in
 * the viewer, and no chat, advances a step. The commands are text for the user
 * to copy; the page never runs one.
 */

export const STEP_IDS = [
  "checkout",
  "observe",
  "slice",
  "contract",
  "grant",
  "evidence",
] as const;
export type StepId = (typeof STEP_IDS)[number];
export type StepStatus = "present" | "missing" | "incomplete";

export const STEP_COMMANDS: Readonly<
  Record<StepId, { label: string; command: string }>
> = {
  checkout: { label: "Checkout", command: "git clone <client-repo>" },
  observe: {
    label: "Observe",
    command: "hexagen observe --out .hexagen/observed.json",
  },
  slice: { label: "Slice", command: "hexagen slice init --path <path>" },
  contract: { label: "Contract", command: "hexagen contract check" },
  grant: { label: "Grant", command: "hexagen grant issue" },
  evidence: { label: "Evidence", command: "hexagen evidence pack" },
};

export interface TraceTailLine {
  /** Line index in the trace; matches the pack's verdict `seq`. */
  readonly seq: number;
  readonly text: string;
  readonly denial: boolean;
}

export interface EvidenceView {
  readonly tail: readonly TraceTailLine[];
  readonly denials: PackVerdicts["denials"];
  /** The pack's recorded result, in words; null when no verdicts were bundled. */
  readonly verdict: string | null;
}

export interface StepView {
  readonly id: StepId;
  readonly label: string;
  readonly command: string;
  readonly status: StepStatus;
  readonly detail: readonly string[];
  readonly evidence?: EvidenceView;
}

export const TRACE_TAIL_LINES = 20;

function observeStep(b: LoadedBundle): Pick<StepView, "status" | "detail"> {
  const o = b.observed;
  if (o === null) return { status: "missing", detail: ["no observed.json"] };
  const detail: string[] = [];
  if (!edgesComplete(o.edges)) {
    detail.push(
      o.edges.collected
        ? `import edges incomplete: unread languages ${o.edges.unreadLanguages.join(", ")}`
        : `import edges not collected: ${o.edges.reason}`,
    );
  }
  if (o.limits.truncated) detail.push("the scan was truncated");
  for (const [name, section] of [
    ["packages", o.packages],
    ["languages", o.languages],
    ["unresolved imports", o.unresolved],
  ] as const) {
    if (!section.collected)
      detail.push(`${name} not collected: ${section.reason}`);
  }
  return detail.length > 0
    ? { status: "incomplete", detail }
    : { status: "present", detail: ["observed.json read"] };
}

function evidenceStep(
  b: LoadedBundle,
): Pick<StepView, "status" | "detail" | "evidence"> {
  if (b.trace === null) {
    return { status: "missing", detail: ["no evidence/trace.jsonl"] };
  }
  const lines = b.trace.split("\n").filter((l) => l.trim() !== "");
  const verdicts = b.verdicts !== "invalid" ? b.verdicts : null;
  const denialSeqs = new Set(verdicts?.denials.map((d) => d.seq) ?? []);
  const tail = lines
    .map((text, seq) => ({ seq, text, denial: denialSeqs.has(seq) }))
    .slice(-TRACE_TAIL_LINES);
  let verdict: string | null = null;
  if (verdicts !== null) {
    const bad = verdicts.lines.filter((l) => !l.valid).length;
    verdict =
      bad === 0
        ? `all ${verdicts.lines.length} trace lines valid; ${verdicts.evidence.count} evidence, ${verdicts.denials.length} denied`
        : `${bad} of ${verdicts.lines.length} trace lines invalid`;
  }
  const detail: string[] = [];
  if (b.verdicts === null) detail.push("no evidence/verdicts.json");
  if (b.verdicts === "invalid")
    detail.push("evidence/verdicts.json is unreadable");
  if (b.tip === null) detail.push("no tip.json");
  return {
    status: detail.length > 0 ? "incomplete" : "present",
    detail: detail.length > 0 ? detail : [`${lines.length} trace lines`],
    evidence: { tail, denials: verdicts?.denials ?? [], verdict },
  };
}

export function deriveSteps(b: LoadedBundle): StepView[] {
  const base = (id: StepId) => ({ id, ...STEP_COMMANDS[id] });
  const checkout: Pick<StepView, "status" | "detail"> =
    b.slice !== null
      ? {
          status: "present",
          detail: [
            `commit ${b.slice.repo.commit}`,
            ...(b.slice.repo.remote === undefined
              ? []
              : [`remote ${b.slice.repo.remote}`]),
          ],
        }
      : { status: "missing", detail: ["no slice.json, so no recorded commit"] };
  const slice: Pick<StepView, "status" | "detail"> =
    b.slice === null
      ? { status: "missing", detail: ["no slice.json"] }
      : {
          status: "present",
          detail: [`slice ${b.slice.id}: ${b.slice.paths.length} path(s)`],
        };
  const contract: Pick<StepView, "status" | "detail"> =
    b.contract === null
      ? { status: "missing", detail: ["no contract.json"] }
      : b.slice !== null && b.contract.sliceId !== b.slice.id
        ? {
            status: "incomplete",
            detail: [
              `the contract names slice ${b.contract.sliceId}, not ${b.slice.id}`,
            ],
          }
        : {
            status: "present",
            detail: [`${b.contract.rules.length} rule(s)`],
          };
  const grant: Pick<StepView, "status" | "detail"> =
    b.grants.length === 0
      ? { status: "missing", detail: ["no grant in the bundle"] }
      : { status: "present", detail: [`${b.grants.length} grant file(s)`] };
  return [
    { ...base("checkout"), ...checkout },
    { ...base("observe"), ...observeStep(b) },
    { ...base("slice"), ...slice },
    { ...base("contract"), ...contract },
    { ...base("grant"), ...grant },
    { ...base("evidence"), ...evidenceStep(b) },
  ];
}
