import { readEvents } from "./events.js";
import type { EventKind, Stage, WaveEvent } from "./wave-types.js";

// The vocabulary, for error messages only — acceptance of an event is always
// decided by W1's reader below, never by a second hand-written check.
const STAGES: readonly Stage[] = [
  "plan-review",
  "dispatch",
  "implement",
  "gate",
  "review",
  "remediate",
  "sweep",
  "merge",
  "record",
];

const EVENT_KINDS: readonly EventKind[] = ["started", "settled", "failed"];

const VOCABULARY = `stage is one of: ${STAGES.join("|")}; event is one of: ${EVENT_KINDS.join("|")}`;

export type EventInput = Omit<WaveEvent, "ts"> & { readonly ts?: string };

export interface EmitDeps {
  readonly appendFile: (path: string, data: string) => Promise<void>;
  readonly clock: () => string;
}

export function formatEvent(input: EventInput, clock: () => string): string {
  const candidate: WaveEvent = {
    ts: input.ts ?? clock(),
    wave: input.wave,
    ...(input.repo !== undefined ? { repo: input.repo } : {}),
    lane: input.lane,
    stage: input.stage,
    event: input.event,
    ...(input.pr !== undefined ? { pr: input.pr } : {}),
    ...(input.round !== undefined ? { round: input.round } : {}),
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
  };
  const line = `${JSON.stringify(candidate)}\n`;

  // Round-trip through the log's own parser: formatEvent may only emit what
  // readEvents accepts, so the two can never drift apart.
  const { rejected } = readEvents(line);
  if (rejected.length > 0) {
    throw new Error(`invalid wave event — ${VOCABULARY}: ${line.trim()}`);
  }
  return line;
}

export async function appendEvent(
  path: string,
  input: EventInput,
  deps: EmitDeps,
): Promise<void> {
  await deps.appendFile(path, formatEvent(input, deps.clock));
}
