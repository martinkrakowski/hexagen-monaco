import type { Branded } from "@hexagen/shared";

export type Timestamp = Branded<number, "Timestamp">;

export const createTimestamp = (ms?: number): Timestamp =>
  (ms ?? Date.now()) as Timestamp;

export const timestampValue = (ts: Timestamp): number =>
  ts as unknown as number;
