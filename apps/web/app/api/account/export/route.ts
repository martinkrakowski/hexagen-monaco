import { NextRequest, NextResponse } from "next/server";
import { getPlatformStore } from "../../../../lib/platform";
import { requirePersistenceOwner } from "../../../../lib/platform/require-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Offboarding artifact: everything this account holds in its PERSONAL tenant.
 *
 * H0.2. Consultants ask for an archive when an engagement ends, and "we can
 * export it" has to be true before teams exist, not after.
 *
 * Personal tenant only. Being a member of an org does not make that org's
 * projects the caller's to download, so no org, team, grant or audit row
 * appears here — those are read through `requireTenant`/`resolveProjectAccess`
 * on their own routes, and P-A7 adds the caller's OWN grant rows to this
 * bundle. Every store below is constructed from `owner.ownerId`, which is the
 * JWT `sub`: the scoping is structural, not a filter applied afterwards.
 *
 * BYOK never appears, and not because it is filtered out. `byok-store.ts`
 * lives in a SEPARATE database (`BYOK_DB_PATH`, `/data/byok.db`) that this
 * route does not open, and its schema has no ciphertext column at all — only
 * key metadata and revocations (ADR-0030: ciphertext is never persisted
 * server-side). Unreachable beats redacted.
 */

/**
 * The run-history read is explicitly bounded. `list()` defaults to 100 rows,
 * which would make an "archive" quietly incomplete for any active account —
 * the failure mode where a green download hides missing data. A stated ceiling
 * that the bundle reports is honest; a silent default is not. If an account
 * ever exceeds it, `runs.truncated` says so rather than the archive lying.
 */
const RUN_EXPORT_LIMIT = 10_000;

export async function GET(request: NextRequest) {
  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner.response;

  const store = getPlatformStore();

  const loaded = await store.projectsFor(owner.ownerId).loadProjects();
  if (!loaded.success) {
    // Wire body stays a stable client-safe string; details stay in-process.
    // eslint-disable-next-line no-console -- persistence diagnostics must not leave the process
    console.error(
      "[account/export] loadProjects failed:",
      loaded.error.kind,
      loaded.error.message,
    );
    return NextResponse.json(
      {
        error: "persistence",
        message: "Unable to load projects for export",
        statusCode: 500,
      },
      { status: 500 },
    );
  }

  // `RunHistoryRepository.list` is synchronous (better-sqlite3 `.all()`).
  // Probe one past the ceiling: SQL LIMIT cannot tell "exactly N stored"
  // from "more than N stored" when the result length equals the limit.
  const listed = store
    .runsFor(owner.ownerId)
    .list({ limit: RUN_EXPORT_LIMIT + 1 });
  const truncated = listed.length > RUN_EXPORT_LIMIT;
  const events = truncated ? listed.slice(0, RUN_EXPORT_LIMIT) : listed;
  const entitlement = store.billing.resolve(owner.ownerId);

  const bundle = {
    schemaVersion: 1 as const,
    exportedAt: new Date().toISOString(),
    ownerId: owner.ownerId,
    scope: "personal-tenant" as const,
    projects: loaded.value,
    runs: {
      limit: RUN_EXPORT_LIMIT,
      truncated,
      events,
    },
    entitlement,
  };

  const filename = `hexagen-account-export-${bundle.exportedAt.slice(0, 10)}.json`;
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // An offboarding archive must never be served from an intermediary.
      "cache-control": "no-store, private",
    },
  });
}
