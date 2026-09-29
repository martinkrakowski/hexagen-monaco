import type { EventKind, Stage, WaveEvent } from "./wave-types.js";

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

export function readEvents(text: string): {
  readonly events: readonly WaveEvent[];
  readonly truncated: boolean;
  readonly rejected: readonly string[];
} {
  const events: WaveEvent[] = [];
  const rejected: string[] = [];
  let truncated = false;

  if (text.length === 0) {
    return { events, truncated, rejected };
  }

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;

    try {
      const parsed = asWaveEvent(JSON.parse(line));
      if (parsed === undefined) {
        rejected.push(line);
        continue;
      }
      events.push(parsed);
    } catch {
      if (i === lines.length - 1 && !text.endsWith("\n")) {
        truncated = true;
      } else {
        rejected.push(line);
      }
    }
  }

  return { events, truncated, rejected };
}

function asWaveEvent(value: unknown): WaveEvent | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const rec = value as Record<string, unknown>;
  if (typeof rec.ts !== "string") return undefined;
  if (typeof rec.wave !== "string") return undefined;
  if (typeof rec.lane !== "string") return undefined;
  if (!isStage(rec.stage)) return undefined;
  if (!isEventKind(rec.event)) return undefined;
  if (rec.pr !== undefined && typeof rec.pr !== "number") return undefined;
  if (rec.round !== undefined && typeof rec.round !== "number")
    return undefined;
  if (rec.detail !== undefined && !isDetail(rec.detail)) return undefined;

  return {
    ts: rec.ts,
    wave: rec.wave,
    lane: rec.lane,
    stage: rec.stage,
    event: rec.event,
    ...(rec.pr !== undefined ? { pr: rec.pr } : {}),
    ...(rec.round !== undefined ? { round: rec.round } : {}),
    ...(rec.detail !== undefined ? { detail: rec.detail } : {}),
  };
}

function isStage(value: unknown): value is Stage {
  return (
    typeof value === "string" && (STAGES as readonly string[]).includes(value)
  );
}

function isEventKind(value: unknown): value is EventKind {
  return (
    typeof value === "string" &&
    (EVENT_KINDS as readonly string[]).includes(value)
  );
}

function isDetail(value: unknown): value is NonNullable<WaveEvent["detail"]> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
