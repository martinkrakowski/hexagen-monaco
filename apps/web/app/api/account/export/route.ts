import { NextRequest, NextResponse } from "next/server";
import {
  getPlatformStore,
  type ListDocumentsResult,
} from "../../../../lib/platform";
import { requirePersistenceOwner } from "../../../../lib/platform/require-owner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Offboarding artifact: the personal tenant, for everything except documents —
 * those are what this account authored in any tenant it still belongs to.
 *
 * H0.2. Consultants ask for an archive when an engagement ends, and "we can
 * export it" has to be true before teams exist, not after.
 *
 * Personal tenant only, except for documents (which follow below): a document
 * is readable only by its author, so this export includes what the account
 * authored in every tenant it is still a member of. Being a member of an org
 * does not make that org's projects the caller's to download, so aside from
 * the account's own documents no org, team, grant or audit row appears here —
 * those are read through `requireTenant`/`resolveProjectAccess` on their own
 * routes, and P-A7 adds the caller's OWN grant rows to this bundle. Every store
 * below is constructed from `owner.ownerId`, which is the JWT `sub`: the
 * scoping is structural, not a filter applied afterwards.
 *
 * BYOK never appears, and not because it is filtered out. `byok-store.ts`
 * lives in a SEPARATE database (`BYOK_DB_PATH`, `/data/byok.db`) that this
 * route does not open, and its schema has no ciphertext column at all — only
 * key metadata and revocations (ADR-0030: ciphertext is never persisted
 * server-side). Unreachable beats redacted.
 *
 * Documents are the exception and cross tenant boundaries: the export includes
 * every document the account authored, in every tenant (its personal one and
 * every org it belongs to), because a document is readable only by its author
 * and the author is the signed-in user (`owner.ownerId`, the JWT `sub`), never a
 * request parameter. No other org data — grants, teams, members, audit rows —
 * appears here; only this account's own documents.
 */

/**
 * The run-history read is explicitly bounded. `list()` defaults to 100 rows,
 * which would make an "archive" quietly incomplete for any active account —
 * the failure mode where a green download hides missing data. A stated ceiling
 * that the bundle reports is honest; a silent default is not. If an account
 * ever exceeds it, `runs.truncated` says so rather than the archive lying.
 */
const RUN_EXPORT_LIMIT = 10_000;

/**
 * Document reads are likewise bounded. `documentsAuthoredBy` takes an explicit
 * LIMIT rather than streaming unboundedly, so the export never quietly stops
 * short. If an account authored more than this ceiling, the bundle's
 * `documents.truncated` reports it rather than the archive lying. Mirrors
 * RUN_EXPORT_LIMIT.
 */
const DOCUMENT_EXPORT_LIMIT = 10_000;

/**
 * Mirror of V8's string ceiling (~536M chars): an account whose documents total
 * more payload text than this would make `JSON.stringify` throw `RangeError`,
 * killing the download. Cap the byte budget instead so the archive reports
 * `documents.truncatedBy === "size"` rather than crashing.
 */
const DOCUMENT_EXPORT_MAX_CHARS = 100_000_000;

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

  // `RunHistoryRepository.list` is async (the driver is moving to an
  // asynchronous path), so it is awaited below.
  // Probe one past the ceiling: SQL LIMIT cannot tell "exactly N stored"
  // from "more than N stored" when the result length equals the limit.
  const listed = await store
    .runsFor(owner.ownerId)
    .list({ limit: RUN_EXPORT_LIMIT + 1 });
  const truncated = listed.length > RUN_EXPORT_LIMIT;
  const events = truncated ? listed.slice(0, RUN_EXPORT_LIMIT) : listed;

  // Documents: every document this account authored, in every tenant. Bounded
  // by `DOCUMENT_EXPORT_LIMIT` rows and `DOCUMENT_EXPORT_MAX_CHARS` of payload
  // text; `documentsAuthoredBy` reports which ceiling stopped the read.
  let documents: ListDocumentsResult;
  try {
    documents = await store.documentsAuthoredBy(
      owner.ownerId,
      DOCUMENT_EXPORT_LIMIT,
      DOCUMENT_EXPORT_MAX_CHARS,
    );
  } catch (cause) {
    // eslint-disable-next-line no-console -- persistence diagnostics must not leave the process
    console.error("[account/export] documentsAuthoredBy failed:", cause);
    return NextResponse.json(
      {
        error: "persistence",
        message: "Unable to load documents for export",
        statusCode: 500,
      },
      { status: 500 },
    );
  }
  const entitlement = await store.billing.resolve(owner.ownerId);

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
    documents: {
      scope: "authored-in-any-tenant" as const,
      limit: DOCUMENT_EXPORT_LIMIT,
      maxChars: DOCUMENT_EXPORT_MAX_CHARS,
      truncated: documents.truncatedBy !== null,
      truncatedBy: documents.truncatedBy,
      items: documents.items,
    },
    entitlement,
  };

  const filename = `hexagen-account-export-${bundle.exportedAt.slice(0, 10)}.json`;
  let bodyText: string;
  try {
    bodyText = JSON.stringify(bundle, null, 2);
  } catch (cause) {
    // eslint-disable-next-line no-console -- persistence diagnostics must not leave the process
    console.error("[account/export] JSON.stringify failed:", cause);
    return NextResponse.json(
      {
        error: "persistence",
        message: "Unable to serialize export",
        statusCode: 500,
      },
      { status: 500 },
    );
  }
  return new NextResponse(bodyText, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      // An offboarding archive must never be served from an intermediary.
      "cache-control": "no-store, private",
    },
  });
}
