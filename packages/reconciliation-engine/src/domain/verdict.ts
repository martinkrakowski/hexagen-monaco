export type Verdict = {
  id: string;
  patchId: string;
  accepted: boolean;
  reason: string;
  timestamp: number;
};

export function createVerdict(
  patchId: string,
  accepted: boolean,
  reason: string = "",
): Verdict {
  return {
    id: `verdict-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    patchId,
    accepted,
    reason,
    timestamp: Date.now(),
  };
}
