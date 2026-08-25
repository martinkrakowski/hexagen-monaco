import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { guardMutation, readJsonBody } from "../../lib/request-guards";
import { getPlatformStore } from "../../../lib/platform";
import {
  PROJECT_MUTATION_GUARD,
  requirePersistenceOwner,
  requireTenant,
} from "../../../lib/platform/require-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const telemetrySchema = z.object({
  stage: z.number(),
  label: z.string(),
  durationMs: z.number(),
  usedLLM: z.boolean(),
  retryCount: z.number(),
  inputTokensEstimate: z.number(),
  outputTokensActual: z.number(),
  servedFromCache: z.boolean(),
  summary: z.string(),
  modelName: z.string().optional(),
  refinerModelName: z.string().optional(),
});

const persistBodySchema = z.object({
  runId: z.string().min(1).optional(),
  projectId: z.string().uuid().optional(),
  // trim() so "   " is invalid (400), not a silent write to personal history.
  tenantId: z.string().trim().min(1).optional(),
  telemetry: telemetrySchema,
});

/** Query `?tenantId=` / whitespace is "not specified" → personal history. */
function queryTenantId(request: NextRequest): string | undefined {
  const trimmed = request.nextUrl.searchParams.get("tenantId")?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * H1.5 — whose history is this?
 *
 * Absent `tenantId` the caller acts as themselves, which is every request that
 * predates orgs: the personal path is unchanged. With one, `requireTenant`
 * decides — 401 without a session, 403 unless the caller IS that tenant or
 * holds an `org_members` row for it. Membership is read per request, so a
 * removal takes effect on the next call rather than when a token expires.
 *
 * Returning the resolved owner (not just a yes/no) is what keeps the store
 * owner-scoped: `runsFor(ownerId)` is unchanged, and only the id it is handed
 * differs.
 */
async function resolveHistoryOwner(
  request: NextRequest,
  tenantId: string | undefined,
): Promise<
  { ok: true; ownerId: string } | { ok: false; response: NextResponse }
> {
  if (!tenantId) {
    const owner = await requirePersistenceOwner(request);
    return owner.ok
      ? { ok: true, ownerId: owner.ownerId }
      : { ok: false, response: owner.response };
  }
  const tenant = await requireTenant(request, tenantId);
  return tenant.ok
    ? { ok: true, ownerId: tenant.tenantId }
    : { ok: false, response: tenant.response };
}

export async function GET(request: NextRequest) {
  const owner = await resolveHistoryOwner(request, queryTenantId(request));
  if (!owner.ok) return owner.response;

  const projectId = request.nextUrl.searchParams.get("projectId") ?? undefined;
  if (projectId) {
    const parsed = z.string().uuid().safeParse(projectId);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation", message: "Invalid project ID format" },
        { status: 400 },
      );
    }
  }
  const runs = getPlatformStore().runsFor(owner.ownerId);
  return NextResponse.json({
    events: runs.list({ projectId, limit: 100 }),
    trend: runs.trend(14),
  });
}

export async function POST(request: NextRequest) {
  // A session is required before anything else reads the body: an unauthenticated
  // caller must not be able to spend the rate-limit budget or the parse.
  const session = await requirePersistenceOwner(request);
  if (!session.ok) return session.response;
  const gate = guardMutation(request, PROJECT_MUTATION_GUARD);
  if (gate) return gate;

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  const parsed = persistBodySchema.safeParse(parsedBody.body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation", message: "Invalid run telemetry payload" },
      { status: 400 },
    );
  }

  // The tenant arrives in the body, so authorisation for it happens here
  // rather than at the top. A non-member gets 403 and nothing is written.
  const owner = await resolveHistoryOwner(request, parsed.data.tenantId);
  if (!owner.ok) return owner.response;

  // PersistRunEventInput has no tenantId; pick the recorded fields so a
  // future spread of parsed.data cannot write the tenant onto the event.
  const recorded = getPlatformStore().runsFor(owner.ownerId).record({
    runId: parsed.data.runId,
    projectId: parsed.data.projectId,
    telemetry: parsed.data.telemetry,
  });
  return NextResponse.json(recorded, { status: 201 });
}
