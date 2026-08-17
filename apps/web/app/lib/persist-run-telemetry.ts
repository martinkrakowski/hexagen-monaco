import type { StageTelemetryInput } from "../../lib/platform";

export function persistStageTelemetry(
  telemetry: StageTelemetryInput,
  extras: { runId?: string; projectId?: string } = {},
): void {
  void fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      telemetry,
      runId: extras.runId,
      projectId: extras.projectId,
    }),
  }).catch(() => {
    // Best-effort: a dropped history row must not fail generation.
  });
}
