// GET /api/health — readiness probe. 200 when healthy, 503 when degraded.
//
// Standalone by default (a liveness/process check). As you install templates
// that own external services, push their checks into `checks` — e.g. ping Redis
// (bullmq/rate-limiting), Supabase, or verify the LLM key is configured. Keep
// each check fast and time-boxed; a health probe must not hang.

export const dynamic = "force-dynamic";

interface HealthCheck {
  name: string;
  status: "ok" | "degraded";
  [detail: string]: unknown;
}

export async function GET(): Promise<Response> {
  const checks: HealthCheck[] = [
    {
      name: "process",
      status: "ok",
      uptimeSeconds: Math.round(process.uptime()),
    },
  ];

  const healthy = checks.every((check) => check.status === "ok");

  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      version: process.env.npm_package_version ?? "unknown",
      uptime: process.uptime(),
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
