import { NextRequest, NextResponse } from "next/server";
import { projectIdSchema } from "./schemas/project-id-schema";
import { guardMutation } from "./request-guards";
import { getPlatformStore } from "../../lib/platform";
import {
  DOCUMENT_MUTATION_GUARD,
  requirePersistenceOwner,
  requireTenant,
} from "../../lib/platform/require-owner";
import type {
  DocumentKind,
  OwnerDocument,
  OwnerDocumentsError,
} from "../../lib/platform/owner-documents-store";
import {
  DOCUMENT_ID_PATTERN,
  DOCUMENT_MAX_PAYLOAD_LENGTH,
} from "../../lib/platform/owner-documents-store";

/**
 * Kinds the routes accept. `brownfield-draft` is a store kind but is refused
 * here until the packet that gives it its server-side age limit.
 */
const ROUTE_DOCUMENT_KINDS: readonly DocumentKind[] = [
  "workspace",
  "governance",
  "canvas-layout",
];

// --- shared error responses ---

/** Mirrors the project handlers' 400 "invalid id" shape (error: "validation"). */
function invalidKind(kind: string): NextResponse {
  return NextResponse.json(
    {
      error: "validation",
      message: `Invalid document kind: ${kind}`,
      statusCode: 400,
    },
    { status: 400 },
  );
}

/** Mirrors `invalidId()` in project-route-handlers.ts. */
function invalidId(): NextResponse {
  return NextResponse.json(
    {
      error: "validation",
      message: "Invalid document ID format",
      statusCode: 400,
    },
    { status: 400 },
  );
}

/** Mirrors `notFound()` in project-route-handlers.ts. */
function notFound(): NextResponse {
  return NextResponse.json(
    { error: "not_found", message: "Document not found", statusCode: 404 },
    { status: 404 },
  );
}

/** Mirrors `persistenceError()` in project-route-handlers.ts. */
function persistenceError(kind: string, message: string): NextResponse {
  return NextResponse.json(
    { error: kind, message, statusCode: 500 },
    { status: 500 },
  );
}

/** Mirrors `malformedIfMatch()` in project-route-handlers.ts. */
function malformedIfMatch(): { ok: false; response: NextResponse } {
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: "validation",
        message: "Invalid If-Match precondition",
        statusCode: 400,
      },
      { status: 400 },
    ),
  };
}

/** The payload cap plus room for the envelope around it. */
const DOCUMENT_BODY_LIMIT = DOCUMENT_MAX_PAYLOAD_LENGTH + 1024;

/**
 * The same limit in bytes. A UTF-16 code unit is at most three UTF-8 bytes, so
 * no body within the character limit is longer than this.
 */
const DOCUMENT_BODY_BYTE_LIMIT = DOCUMENT_BODY_LIMIT * 3;

/**
 * Reads the body as text, giving up as soon as it has seen more bytes than any
 * allowed body can have. A body sent without a Content-Length (chunked) is
 * therefore never held in memory beyond the limit. Returns null when it gave up.
 */
async function readBodyBounded(request: NextRequest): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let seen = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    seen += value.byteLength;
    if (seen > DOCUMENT_BODY_BYTE_LIMIT) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function payloadTooLarge(): NextResponse {
  return NextResponse.json(
    {
      error: "payload_too_large",
      message: `Document exceeds ${DOCUMENT_MAX_PAYLOAD_LENGTH} characters`,
      statusCode: 413,
    },
    { status: 413 },
  );
}

// --- shared validators ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Canonical `rev:<n>` must be a non-negative safe integer. */
function parseNonNegativeSafeInteger(digits: string): number | null {
  if (digits.length === 0 || digits.length > 16) return null;
  const n = Number(digits);
  if (!Number.isSafeInteger(n) || n < 0) return null;
  return n;
}

/**
 * Document If-Match parser. Unlike the project parser, a bare number is NOT
 * accepted as a legacy `updated_at` form — documents have no pre-H1.4 history,
 * so an untagged number is malformed. Accepted: absent / empty / `*`, and
 * `rev:<n>` (with `W/` prefix and quotes tolerated, as the project parser
 * does). Anything else is 400.
 */
function parseDocumentIfMatch(
  request: NextRequest,
): { ok: true; expectedRev?: number } | { ok: false; response: NextResponse } {
  const raw = request.headers.get("If-Match");
  if (raw == null || raw === "" || raw === "*") return { ok: true };
  const trimmed = raw.trim().replace(/^W\//, "").replaceAll('"', "");

  const revMatch = /^rev:(\d+)$/.exec(trimmed);
  if (revMatch) {
    const rev = parseNonNegativeSafeInteger(revMatch[1] ?? "");
    if (rev === null) return malformedIfMatch();
    return { ok: true, expectedRev: rev };
  }

  // No legacy numeric form for documents: a bare number is malformed.
  return malformedIfMatch();
}

function invalidIfNoneMatch(): { ok: false; response: NextResponse } {
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: "validation",
        message: "Invalid If-None-Match precondition",
        statusCode: 400,
      },
      { status: 400 },
    ),
  };
}

/**
 * Parses `If-None-Match` for documents. Absent, empty, or `*` (after trimming)
 * all mean "unconditional" — but `*` is special-cased to `createOnly` (refuse
 * to overwrite an existing copy). Any other non-empty value (a quoted ETag, a
 * list, etc.) is a malformed 400.
 */
function parseDocumentIfNoneMatch(
  request: NextRequest,
): { ok: true; createOnly: boolean } | { ok: false; response: NextResponse } {
  const raw = request.headers.get("If-None-Match");
  if (raw == null) return { ok: true, createOnly: false };
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "*")
    return { ok: true, createOnly: trimmed === "*" };
  return invalidIfNoneMatch();
}

function preconditionFailed(currentRev: number): NextResponse {
  return NextResponse.json(
    {
      error: "precondition_failed",
      message: `document was updated elsewhere; expected the current rev`,
      statusCode: 412,
    },
    { status: 412, headers: { ETag: `"rev:${currentRev}"` } },
  );
}

// --- store error mapping ---

/**
 * Maps an `OwnerDocumentsError` to the same response shape the project
 * handlers use for each category: validation 400, not-found 404, Conflict 409,
 * persistence 500.
 */
function mapStoreError(error: OwnerDocumentsError): NextResponse {
  if (error.kind === "InvalidInput") {
    return NextResponse.json(
      {
        error: "validation",
        message: error.message,
        statusCode: 400,
      },
      { status: 400 },
    );
  }
  if (error.kind === "UnknownProject") {
    return NextResponse.json(
      {
        error: "validation",
        message: "projectId names no project in this tenant",
        statusCode: 400,
      },
      { status: 400 },
    );
  }
  if (error.kind === "Conflict") {
    return NextResponse.json(
      { error: "Conflict", message: error.message, statusCode: 409 },
      { status: 409 },
    );
  }
  if (error.kind === "PreconditionFailed") {
    return preconditionFailed(error.currentRev);
  }
  if (error.kind === "NotAMember") {
    return NextResponse.json(
      {
        error: "forbidden",
        message: "You do not have access to this tenant",
        statusCode: 403,
      },
      { status: 403 },
    );
  }
  if (error.kind === "NotFound") {
    return notFound();
  }
  return persistenceError(error.kind, error.message);
}

// --- response builders ---

function documentBody(doc: OwnerDocument): unknown {
  return {
    kind: doc.kind,
    id: doc.id,
    projectId: doc.projectId,
    payload: doc.payload,
    updatedAt: doc.updatedAt,
  };
}

function documentResponse(doc: OwnerDocument): NextResponse {
  return NextResponse.json(documentBody(doc), {
    headers: { ETag: `"rev:${doc.rev}"` },
  });
}

// --- handlers ---

/**
 * GET /api/tenants/[ownerId]/documents?kind=&projectId=
 *
 * Lists the signed-in user's documents under the tenant address. `kind` and
 * `projectId` are optional query filters; each is validated when present.
 */
export async function handleDocumentList(
  request: NextRequest,
  ownerId: string,
): Promise<NextResponse> {
  const kindParam = request.nextUrl.searchParams.get("kind");
  const projectIdParam = request.nextUrl.searchParams.get("projectId");

  let filter: { kind?: DocumentKind; projectId?: string } | undefined;

  if (kindParam) {
    if (!ROUTE_DOCUMENT_KINDS.some((k) => k === kindParam)) {
      return invalidKind(kindParam);
    }
    filter = { ...filter, kind: kindParam as DocumentKind };
  }

  if (projectIdParam) {
    const parsed = projectIdSchema.safeParse(projectIdParam);
    if (!parsed.success) return invalidId();
    filter = { ...filter, projectId: parsed.data };
  }

  const tenant = await requireTenant(request, ownerId);
  if (!tenant.ok) return tenant.response;

  const store = getPlatformStore().documentsFor(tenant.tenantId, tenant.userId);
  const loaded = await store.list(filter);
  if (!loaded.success) {
    return mapStoreError(loaded.error);
  }
  return NextResponse.json({ documents: loaded.value });
}

/**
 * GET /api/tenants/[ownerId]/documents/[kind]/[id]
 *
 * Fetches one document by key. A 404 here is only reachable AFTER the tenant
 * access check has passed, so it cannot probe another tenant (D-A4).
 */
export async function handleDocumentGet(
  request: NextRequest,
  ownerId: string,
  kind: string,
  id: string,
): Promise<NextResponse> {
  if (!ROUTE_DOCUMENT_KINDS.some((k) => k === kind)) {
    return invalidKind(kind);
  }
  if (!DOCUMENT_ID_PATTERN.test(id)) {
    return invalidId();
  }

  const tenant = await requireTenant(request, ownerId);
  if (!tenant.ok) return tenant.response;

  const store = getPlatformStore().documentsFor(tenant.tenantId, tenant.userId);
  const found = await store.get(kind as DocumentKind, id);
  if (!found.success) {
    return mapStoreError(found.error);
  }
  if (!found.value) return notFound();
  return documentResponse(found.value);
}

/**
 * PUT /api/tenants/[ownerId]/documents/[kind]/[id]
 *
 * Creates or replaces a document. A `projectId` of `undefined` or `null`
 * detaches the document from any project: it then lives under (tenant, author)
 * only, and deleting a project will not reach it. A caller that wants a
 * document deleted with its project sends `projectId` on every PUT.
 *
 * Optional preconditions:
 * - `If-None-Match: *` — create-only: refuse with 412 if the document already
 *   exists, so a first upload never clobbers a copy another device wrote.
 * - `If-Match: "rev:<n>"` — optimistic concurrency: replace only if the stored
 *   rev equals `<n>`; a stale rev is 409 (existing behavior). `If-None-Match: *`
 *   cannot be combined with `If-Match`.
 *
 * The mutation gate authenticates first (401) then rate-limits / origin-checks,
 * so unsigned traffic cannot exhaust the IP-keyed write budget (same rationale
 * as `gateProjectMutation` in project-route-handlers.ts).
 */
export async function handleDocumentPut(
  request: NextRequest,
  ownerId: string,
  kind: string,
  id: string,
): Promise<NextResponse> {
  // 1. Validate kind and id.
  if (!ROUTE_DOCUMENT_KINDS.some((k) => k === kind)) {
    return invalidKind(kind);
  }
  if (!DOCUMENT_ID_PATTERN.test(id)) {
    return invalidId();
  }

  // 2. Mutation gate: authenticate first, then rate-limit / origin-check.
  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner.response;
  const gate = guardMutation(request, DOCUMENT_MUTATION_GUARD);
  if (gate) return gate;

  // 3. requireTenant.
  const tenant = await requireTenant(request, ownerId);
  if (!tenant.ok) return tenant.response;

  // 4. Refuse an oversized body by its declared length before reading it, so
  // the cap also bounds memory; then read once and check the real length,
  // which is what covers a body sent without a Content-Length.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > DOCUMENT_BODY_BYTE_LIMIT) {
    return payloadTooLarge();
  }
  const rawBody = await readBodyBounded(request);
  if (rawBody === null || rawBody.length > DOCUMENT_BODY_LIMIT) {
    return payloadTooLarge();
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    // Same 400 shape as readJsonBody in request-guards.ts.
    return NextResponse.json(
      { error: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  if (!isRecord(body) || !("payload" in body)) {
    return NextResponse.json(
      {
        error: "validation",
        message: "payload is required",
        statusCode: 400,
      },
      { status: 400 },
    );
  }

  // projectId: omitted or null → detached. A string must be a valid UUID.
  const projectIdField: unknown = body.projectId;
  let projectId: string | null | undefined;
  if (projectIdField === undefined) {
    projectId = undefined;
  } else if (projectIdField === null) {
    projectId = null;
  } else if (typeof projectIdField === "string") {
    const parsed = projectIdSchema.safeParse(projectIdField);
    if (!parsed.success) return invalidId();
    projectId = parsed.data;
  } else {
    return NextResponse.json(
      {
        error: "validation",
        message: "projectId must be a string or null",
        statusCode: 400,
      },
      { status: 400 },
    );
  }

  // If-None-Match: `*` means create-only (refuse to overwrite); absent/empty
  // is unconditional. Any other value is a malformed 400.
  const noneMatch = parseDocumentIfNoneMatch(request);
  if (!noneMatch.ok) return noneMatch.response;
  if (noneMatch.createOnly) {
    const match = parseDocumentIfMatch(request);
    if (!match.ok) return match.response;
    if (match.expectedRev !== undefined) {
      return NextResponse.json(
        {
          error: "validation",
          message: "If-None-Match cannot be combined with If-Match",
          statusCode: 400,
        },
        { status: 400 },
      );
    }
  }

  // If-Match: rev:<n> only. A bare number is malformed (no legacy support).
  const precondition = parseDocumentIfMatch(request);
  if (!precondition.ok) return precondition.response;

  // Store call.
  const store = getPlatformStore().documentsFor(tenant.tenantId, tenant.userId);
  const result = await store.put(
    {
      kind: kind as DocumentKind,
      id,
      projectId,
      payload: body.payload,
    },
    precondition.expectedRev,
    { createOnly: noneMatch.createOnly },
  );

  if (result.success) {
    return documentResponse(result.value);
  }

  const storeErr = result.error;
  if (
    storeErr.kind === "PreconditionFailed" ||
    (storeErr.kind === "Conflict" && storeErr.currentRev !== undefined)
  ) {
    // eslint-disable-next-line no-console -- operator-facing diagnostic for repeated refusals
    console.warn("[documents] precondition failed", {
      method: "PUT",
      kind: kind as DocumentKind,
      id,
      sent: noneMatch.createOnly ? "*" : precondition.expectedRev,
      current: storeErr.currentRev,
      audited: storeErr.audited,
    });
  }

  return mapStoreError(result.error);
}

/**
 * DELETE /api/tenants/[ownerId]/documents/[kind]/[id]
 *
 * Removes one document. With no `If-Match` header (or an empty / `*` one),
 * returns 204 whether or not a row existed — a delete of a missing id is
 * idempotent from the client's perspective.
 *
 * Optional precondition: `If-Match: "rev:<n>"` deletes only if the stored rev
 * equals `<n>`; a stale rev is 412 with the current ETag, and a missing row is
 * 404. A malformed `If-Match` is 400.
 */
export async function handleDocumentDelete(
  request: NextRequest,
  ownerId: string,
  kind: string,
  id: string,
): Promise<NextResponse> {
  // 1. Validate kind and id.
  if (!ROUTE_DOCUMENT_KINDS.some((k) => k === kind)) {
    return invalidKind(kind);
  }
  if (!DOCUMENT_ID_PATTERN.test(id)) {
    return invalidId();
  }

  // 2. Mutation gate: authenticate first, then rate-limit / origin-check.
  const owner = await requirePersistenceOwner(request);
  if (!owner.ok) return owner.response;
  const gate = guardMutation(request, DOCUMENT_MUTATION_GUARD);
  if (gate) return gate;

  // 3. requireTenant.
  const tenant = await requireTenant(request, ownerId);
  if (!tenant.ok) return tenant.response;

  // 4. If-Match: rev:<n> only. A bare number is malformed (no legacy support).
  const precondition = parseDocumentIfMatch(request);
  if (!precondition.ok) return precondition.response;

  // 5. Store call.
  const store = getPlatformStore().documentsFor(tenant.tenantId, tenant.userId);
  const result = await store.delete(
    kind as DocumentKind,
    id,
    precondition.expectedRev,
  );
  if (!result.success) {
    const storeErr = result.error;
    if (storeErr.kind === "PreconditionFailed") {
      // eslint-disable-next-line no-console -- operator-facing diagnostic for repeated refusals
      console.warn("[documents] precondition failed", {
        method: "DELETE",
        kind: kind as DocumentKind,
        id,
        sent: precondition.expectedRev ?? "*",
        current: storeErr.currentRev,
        audited: storeErr.audited,
      });
    }
    return mapStoreError(result.error);
  }

  return new NextResponse(null, { status: 204 });
}
