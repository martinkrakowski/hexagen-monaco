"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@hexagen/ui";
import { ProjectsShell } from "@/ProjectsShell";
import type { DailyRunCount, RunEventRecord } from "../../../lib/platform";

interface RunsResponse {
  events: RunEventRecord[];
  trend: DailyRunCount[];
}

interface OrgSummary {
  id: string;
  slug: string;
  name: string;
  role: string;
}

/** The personal tenant has no id: `/api/runs` without `tenantId` is "me". */
const PERSONAL = "";

export function RunHistoryPage() {
  const [tenantId, setTenantId] = useState<string>(PERSONAL);
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [payload, setPayload] = useState<RunsResponse | null>(null);
  const [failed, setFailed] = useState(false);

  // The tenants this caller may switch to. A failure here leaves the selector
  // showing Personal only: not being able to list orgs must not stop someone
  // reading their own history.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/orgs")
      .then(async (response) => {
        if (!response.ok) throw new Error("failed");
        return (await response.json()) as { orgs: OrgSummary[] };
      })
      .then((data) => {
        if (!cancelled) setOrgs(data.orgs);
      })
      .catch(() => {
        // Personal history still works without the org list.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Refetches whenever the tenant changes — the selector is the only input.
  useEffect(() => {
    let cancelled = false;
    setPayload(null);
    setFailed(false);
    const url = tenantId
      ? `/api/runs?tenantId=${encodeURIComponent(tenantId)}`
      : "/api/runs";
    void fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error("failed");
        return (await response.json()) as RunsResponse;
      })
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return (
    <ProjectsShell
      title="Run history"
      footer={
        <Link href="/projects">
          <Button variant="outline" size="sm">
            Back to projects
          </Button>
        </Link>
      }
    >
      <div className="p-4 space-y-6">
        {orgs.length > 0 ? (
          <div className="flex items-center gap-2">
            <label
              htmlFor="run-history-tenant"
              className="text-sm text-muted-foreground"
            >
              History for
            </label>
            <select
              id="run-history-tenant"
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
              className="rounded-lg border border-border bg-card p-2 text-sm text-foreground"
            >
              <option value={PERSONAL}>Personal</option>
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {failed ? (
          <p className="text-sm text-destructive">
            Could not load run history.
          </p>
        ) : !payload ? (
          <p className="text-sm text-muted-foreground">Loading run history…</p>
        ) : (
          <>
            <section className="space-y-2">
              <h2 className="text-lg font-medium text-foreground">Trend</h2>
              {payload.trend.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No generation runs recorded yet.
                </p>
              ) : (
                <ul className="text-sm text-foreground space-y-1">
                  {payload.trend.map((day) => (
                    <li key={day.day} className="font-mono">
                      {day.day}: {day.runs} runs · {day.costCents}¢
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="space-y-2">
              <h2 className="text-lg font-medium text-foreground">Stages</h2>
              {payload.events.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Stage telemetry appears here after a cloud generation run.
                </p>
              ) : (
                <ul className="text-sm space-y-2">
                  {payload.events.map((event) => (
                    <li
                      key={event.id}
                      className="rounded-lg border border-border bg-card p-4 space-y-1"
                    >
                      <div className="font-medium text-foreground">
                        {event.label}
                      </div>
                      <div className="text-muted-foreground font-mono text-xs">
                        {event.model ?? "deterministic"} · {event.durationMs}ms
                        · {event.retryCount} retries · {event.inputTokens}/
                        {event.outputTokens} tok
                        {event.costCents != null
                          ? ` · ${event.costCents}¢`
                          : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </ProjectsShell>
  );
}
