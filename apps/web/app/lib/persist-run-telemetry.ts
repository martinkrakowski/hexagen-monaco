import type { StageTelemetryInput } from "../../lib/platform";

/**
 * Post one stage's telemetry to the active tenant's history.
 *
 * `tenantId` is the org whose history this run belongs to; omitting it posts
 * to the caller's personal history, which is every call site that predates
 * orgs (H1.5). The server authorises the tenant per request — passing an org
 * the caller is not a member of is refused there, not trusted here.
 */
export function persistStageTelemetry(
  telemetry: StageTelemetryInput,
  extras: { runId?: string; projectId?: string; tenantId?: string } = {},
): void {
  void fetch("/api/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      telemetry,
      runId: extras.runId,
      projectId: extras.projectId,
      tenantId: extras.tenantId,
    }),
  }).catch(() => {
    // Best-effort: a dropped history row must not fail generation.
  });
}
