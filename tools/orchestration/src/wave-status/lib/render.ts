/* eslint-disable no-control-regex -- every escape and control byte in this module is named on purpose: neutralising them is the module's whole job, and a regex is the only way to recognise one. */
import type { BacklogState } from "../../internal/backlog.js";
import type { LaneStatus, WaveStatus } from "../../internal/wave-types.js";
import { laneState } from "./lane-state.js";

/**
 * The terminal face of the wave-status tool: the same columns the page renders
 * (public/wave-status/index.html), one block per wave, one line per lane.
 * `renderStatus` is pure — no I/O, no clock, no `process` — so the same status
 * renders the same string anywhere, and colour is an explicit opt-in, never
 * ambient.
 */

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

const DEFAULT_WIDTH = 100;
const ROW_INDENT = "  ";
const COLUMN_GAP = "  ";
const ABSENT = "—";

/** A complete SGR sequence; `^` anchors it, so `exec` only matches at index 0. */
const SGR_PREFIX = /^\x1b\[[0-9;]*m/;

/** A complete non-SGR escape run — e.g. `\x1b[2J` — which the renderer never paints. */
const FOREIGN_ESCAPE =
  /^\x1b(?:\[[\x20-\x3f]*[\x40-\x7e]|(?!\[)[\x20-\x2f]*[\x40-\x7e])/;

export interface RenderOptions {
  readonly width?: number;
  readonly color?: boolean;
  /**
   * The instant lanes are judged against. Given by the caller, never read from
   * a clock here; when omitted it is the status's own `generatedAt`, the
   * instant the facts were collected, so the same status renders the same
   * string wherever and whenever it is rendered.
   */
  readonly nowMs?: number;
}

const withCode = (code: string, text: string): string =>
  `${code}${text}${RESET}`;

/** C0 control bytes (0x00–0x1F) and DEL (0x7F) are terminal control, never text. */
const CONTROL = /[\x00-\x1f\x7f]/g;

/** Identifiers come from filenames on disk; never let their bytes reprogram the terminal. */
function sanitize(identifier: string): string {
  return identifier.replace(CONTROL, "");
}

/** A table column: its plain text, and how that text is painted when colour is on. */
interface Column {
  readonly header: string;
  readonly cell: (lane: LaneStatus, nowMs: number) => string;
  readonly paint: (lane: LaneStatus, text: string, nowMs: number) => string;
}

function laneCell(lane: LaneStatus): string {
  return `${sanitize(lane.wave)}/${sanitize(lane.lane)}`;
}

/**
 * The seat that ran the lane, or the honest word `unknown` when no event ever
 * named one — the same answer the page gives. Never inferred from the lane name
 * or worktree, and sanitized because the value comes off disk.
 */
function seatCell(lane: LaneStatus): string {
  return lane.seat === undefined ? "unknown" : sanitize(lane.seat);
}

export const STALLED_GRACE_MS = 60_000;

/**
 * The word the stage column shows for a lane's last event. A `started` event
 * that has gone unanswered past the launch grace, on a lane no process is
 * running, is no longer "started": the word is then what `laneState` says of
 * the lane — the ONE vocabulary the page and every face share — never a second
 * term of this module's own. Within the grace, or with a timestamp that cannot
 * be read, it stays the event.
 */
function stageWord(
  lane: LaneStatus,
  nowMs: number,
): { readonly word: string; readonly overdue: boolean } {
  const reported = lane.reported;
  if (reported === undefined) return { word: ABSENT, overdue: false };
  if (reported.event !== "started" || lane.derived.alive) {
    return { word: reported.event, overdue: false };
  }
  const ts = Date.parse(reported.ts);
  if (Number.isNaN(ts) || !(nowMs - ts > STALLED_GRACE_MS)) {
    return { word: reported.event, overdue: false };
  }
  return { word: laneState(lane, nowMs), overdue: true };
}

function stageCell(lane: LaneStatus, nowMs: number): string {
  const reported = lane.reported;
  if (reported === undefined) return ABSENT;
  const round =
    reported.round === undefined ? "" : ` (round ${reported.round})`;
  return `${reported.stage} ${stageWord(lane, nowMs).word}${round}`;
}

function livenessCell(lane: LaneStatus): string {
  return lane.derived.alive ? "alive" : "not alive";
}

function prCell(lane: LaneStatus): string {
  const pr = lane.derived.pr;
  if (pr === undefined) return ABSENT;
  const head = `#${pr.number} ${pr.state} ${pr.checks}`;
  // Open PRs always state their thread situation: a count, or `?` for the
  // one that could not be asked. Merged and closed carry no token — threads
  // were never their question.
  if (pr.state !== "open") return head;
  return `${head} threads:${typeof pr.unresolvedThreads === "number" ? pr.unresolvedThreads : "?"}`;
}

function gateCell(lane: LaneStatus): string {
  const gate = lane.derived.gate;
  if (gate === undefined) return ABSENT;
  const exit = gate.exit === undefined ? ABSENT : `exit ${gate.exit}`;
  const coverage =
    gate.coverage === undefined
      ? ""
      : ` · ${gate.coverage.statements}/${gate.coverage.branches}/${gate.coverage.functions}/${gate.coverage.lines}%`;
  return `${exit}${coverage}`;
}

/**
 * The plan-review gate's flag, verbatim or absent. A flag is a disagreement
 * between what was reviewed and what the row is now — it is shown, never
 * resolved into a lane state.
 */
function planReviewCell(lane: LaneStatus): string {
  return lane.derived.planReview === undefined
    ? ABSENT
    : lane.derived.planReview;
}

/**
 * The pre-PR-review gate's flag, verbatim or absent — shown, never resolved
 * into a lane state, exactly like `planReviewCell` above.
 */
function riskCell(lane: LaneStatus): string {
  return lane.derived.risk === undefined ? ABSENT : lane.derived.risk;
}

/** The tones mirror the page: failed red, settled green, started cyan, absent dim. */
const COLUMNS: readonly Column[] = [
  { header: "lane", cell: laneCell, paint: (_lane, text) => text },
  {
    header: "seat",
    cell: seatCell,
    // A seat is a fact, not a status: like the lane name, it carries no tone.
    paint: (_lane, text) => text,
  },
  {
    header: "stage",
    cell: stageCell,
    paint: (lane, text, nowMs) => {
      const event = lane.reported?.event;
      if (event === undefined) return withCode(DIM, text);
      if (event === "failed") return withCode(RED, text);
      if (event === "settled") return withCode(GREEN, text);
      if (event === "started" && stageWord(lane, nowMs).overdue)
        return withCode(YELLOW, text);
      return withCode(CYAN, text);
    },
  },
  {
    header: "liveness",
    cell: livenessCell,
    paint: (lane, text) => withCode(lane.derived.alive ? GREEN : DIM, text),
  },
  {
    header: "pr",
    cell: prCell,
    paint: (lane, text) => {
      const pr = lane.derived.pr;
      if (pr === undefined) return withCode(DIM, text);
      const state =
        pr.state === "merged" ? GREEN : pr.state === "open" ? CYAN : RED;
      const checks =
        pr.checks === "none"
          ? DIM
          : pr.checks === "pending"
            ? YELLOW
            : pr.checks === "pass"
              ? GREEN
              : pr.checks === "fail"
                ? RED
                : YELLOW; // unknown: could not ask — a gap that wants a look, not a failure
      // prCell is `#N state checks[ threads:X]`. The identity and checks
      // tokens carry the old tones; a thread token joins them — dim for the
      // measured nothing, yellow for a count and for the `?` of a read that
      // could not be taken.
      const tokens = text.split(" ");
      const head = `${withCode(state, `${tokens[0]} ${tokens[1]}`)} ${withCode(checks, String(tokens[2]))}`;
      if (tokens[3] === undefined) return head;
      const threads = String(tokens[3]).endsWith(":0") ? DIM : YELLOW;
      return `${head} ${withCode(threads, String(tokens[3]))}`;
    },
  },
  {
    header: "gate",
    cell: gateCell,
    paint: (lane, text) => {
      const gate = lane.derived.gate;
      if (gate === undefined) return withCode(DIM, text);
      const exitEnd =
        gate.exit === undefined ? ABSENT.length : `exit ${gate.exit}`.length;
      const head = withCode(
        gate.exit === undefined ? DIM : gate.exit === 0 ? GREEN : RED,
        text.slice(0, exitEnd),
      );
      return `${head}${text.slice(exitEnd)}`;
    },
  },
  {
    header: "plan review",
    cell: planReviewCell,
    paint: (lane, text) =>
      withCode(lane.derived.planReview === undefined ? DIM : RED, text),
  },
  {
    header: "risk",
    cell: riskCell,
    paint: (lane, text) =>
      withCode(lane.derived.risk === undefined ? DIM : RED, text),
  },
];

/**
 * Cut a line to `width` visible characters — never wrapped, and re-balanced with
 * a reset when a painted span was cut. Only the renderer's own SGR sequences
 * survive: any other escape run is dropped whole, never emitted half a sequence.
 */
export function truncate(line: string, width: number): string {
  if (!line.includes("\x1b")) return line.slice(0, width);
  let out = "";
  let visible = 0;
  for (let i = 0; i < line.length && visible < width; ) {
    const sgr = SGR_PREFIX.exec(line.slice(i));
    if (sgr !== null) {
      out += sgr[0];
      i += sgr[0].length;
      continue;
    }
    if (line[i] === "\x1b") {
      // An escape the renderer did not paint — or one it cannot complete — is
      // dropped in full so the terminal never lands in an unknown state.
      const foreign = FOREIGN_ESCAPE.exec(line.slice(i));
      if (foreign !== null) {
        i += foreign[0].length;
        continue;
      }
      i += 1;
      if (line[i] === "[") i += 1;
      while (i < line.length && /[\x20-\x3f]/.test(line[i])) i += 1;
      // The byte that stopped the run never completed a sequence; drop it too.
      if (i < line.length) i += 1;
      continue;
    }
    out += line[i];
    visible += 1;
    i += 1;
  }
  return out === line ? line : `${out}${RESET}`;
}

function row(
  cells: readonly string[],
  widths: readonly number[],
  paint: ((text: string, column: number) => string) | undefined,
): string {
  return cells
    .map((text, i) => {
      const body = paint === undefined ? text : paint(text, i);
      const pad = i === cells.length - 1 ? 0 : widths[i] - text.length;
      return body + " ".repeat(pad);
    })
    .join(COLUMN_GAP);
}

export function renderStatus(status: WaveStatus, opts?: RenderOptions): string {
  const width = opts?.width ?? DEFAULT_WIDTH;
  const color = opts?.color === true;
  // Given, or the instant the status was collected — never the wall clock.
  const generated = Date.parse(status.generatedAt);
  const nowMs = opts?.nowMs ?? (Number.isNaN(generated) ? 0 : generated);

  // Plain text first: column widths come from what the eye sees, not from codes.
  const waves = status.waves.map((wave) => ({
    id: wave.id,
    rows: wave.lanes.map((lane) => ({
      lane,
      cells: COLUMNS.map((column) => column.cell(lane, nowMs)),
    })),
  }));
  const widths = COLUMNS.map((column, i) =>
    Math.max(
      column.header.length,
      ...waves.flatMap((wave) => wave.rows.map((r) => r.cells[i].length)),
    ),
  );

  const blocks = waves.map((wave) => {
    const block: string[] = [`wave ${sanitize(wave.id)}`];
    if (wave.rows.length > 0) {
      block.push(
        ROW_INDENT +
          row(
            COLUMNS.map((column) => column.header),
            widths,
            color ? (text) => withCode(DIM, text) : undefined,
          ),
      );
      for (const r of wave.rows) {
        block.push(
          ROW_INDENT +
            row(
              r.cells,
              widths,
              color
                ? (text, i) => COLUMNS[i].paint(r.lane, text, nowMs)
                : undefined,
            ),
        );
      }
    }
    return block;
  });
  const body = blocks
    .flatMap((block, i) => (i === 0 ? block : ["", ...block]))
    .map((line) => truncate(line, width))
    .join("\n");

  const sections: string[] = [];
  if (body !== "") sections.push(body);

  // The gap the page refuses to render as "no PR". Here every PR cell would
  // otherwise read as absence — and a bare em dash is read as absence too.
  if (status.prs !== undefined) {
    sections.push(
      truncate(
        `prs: ${status.prs.skipped} row(s) could not be read — a lane with no PR may be one of them`,
        width,
      ),
    );
  }

  if (status.backlog !== undefined) {
    const backlogLines = renderBacklog(status.backlog, color).map((line) =>
      truncate(line, width),
    );
    sections.push(backlogLines.join("\n"));
  }

  return sections.join("\n\n");
}

function renderBacklog(backlog: BacklogState, color: boolean): string[] {
  if (backlog.state === "absent") {
    return ["backlog: no plan:verify run recorded"];
  }
  if (backlog.state === "unknown") {
    return ["backlog: unknown"];
  }
  const { artifact } = backlog;
  const scopeDesc =
    artifact.scope.kind === "partial"
      ? `partial run (${artifact.plans.map(sanitize).join(", ")})`
      : `full run`;
  const headSha = sanitize(artifact.git.head).slice(0, 8);
  const lines: string[] = [
    `backlog (${scopeDesc}) — ${sanitize(artifact.at)} [${sanitize(artifact.git.branch)}@${headSha}]`,
  ];
  if (artifact.premises.length === 0) {
    lines.push(`${ROW_INDENT}(no premises)`);
  } else {
    for (const p of artifact.premises) {
      const reasonText =
        p.reason !== undefined && p.reason !== ""
          ? ` — ${sanitize(p.reason)}`
          : "";
      const statusText = color
        ? p.status === "holds"
          ? withCode(CYAN, p.status)
          : p.status === "stale"
            ? withCode(RED, p.status)
            : withCode(YELLOW, p.status)
        : p.status;
      lines.push(
        `${ROW_INDENT}${sanitize(p.lane)} (${sanitize(p.plan)}): ${statusText}${reasonText}`,
      );
    }
  }
  return lines;
}
