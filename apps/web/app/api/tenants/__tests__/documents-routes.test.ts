import { afterEach, beforeEach, describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import type { SavedProject } from "@hexagen/shared";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { getToken } from "next-auth/jwt";
import { GET as LIST_GET } from "../[ownerId]/documents/route";
import {
  GET as DETAIL_GET,
  PUT as DETAIL_PUT,
  DELETE as DETAIL_DELETE,
} from "../[ownerId]/documents/[kind]/[id]/route";
import { DELETE as PROJECT_DELETE } from "../[ownerId]/projects/[projectId]/route";
import { closePlatformStore, getPlatformStore } from "../../../../lib/platform";
import { DOCUMENT_MAX_PAYLOAD_LENGTH } from "../../../../lib/platform/owner-documents-store";

const OWNER = "user-owner";
const GRANTEE = "user-grantee";
const USER_B = "user-b";
const USER_C = "user-c";
const ORG = "org-acme";
const FOUNDER = "user-founder";
const MEMBER_A = "user-member-a";
const MEMBER_B = "user-member-b";

const KIND = "workspace";
const DOC_ID = "doc-1";
const PROJECT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const UNKNOWN_PROJECT_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function signedInAs(sub: string | null): void {
  vi.mocked(getToken).mockResolvedValue(sub ? ({ sub } as never) : null);
}

function listUrl(ownerId: string): string {
  return `http://localhost/api/tenants/${ownerId}/documents`;
}

function detailUrl(ownerId: string, kind: string, id: string): string {
  return `http://localhost/api/tenants/${ownerId}/documents/${kind}/${id}`;
}

function listParams(ownerId: string) {
  return { params: Promise.resolve({ ownerId }) };
}

function detailParams(ownerId: string, kind: string, id: string) {
  return { params: Promise.resolve({ ownerId, kind, id }) };
}

function putReq(
  ownerId: string,
  kind: string,
  id: string,
  body: string,
  extraHeaders: Record<string, string> = {},
): NextRequest {
  return new NextRequest(detailUrl(ownerId, kind, id), {
    method: "PUT",
    headers: { "content-type": "application/json", ...extraHeaders },
    body,
  });
}

function delReq(
  ownerId: string,
  kind: string,
  id: string,
  extraHeaders: Record<string, string> = {},
): NextRequest {
  return new NextRequest(detailUrl(ownerId, kind, id), {
    method: "DELETE",
    headers: extraHeaders,
  });
}

function sampleProject(id = PROJECT_ID, name = "test-project"): SavedProject {
  return {
    id,
    name,
    schemaVersion: 4,
    createdAt: 1,
    updatedAt: 1,
    formState: {},
    manifestYaml: `system: ${name}\nbounded_contexts: []\n`,
  };
}

async function seedProject(
  ownerId: string,
  projectId = PROJECT_ID,
): Promise<void> {
  const created = await getPlatformStore()
    .projectsFor(ownerId)
    .createProjectRecord(sampleProject(projectId));
  assert.equal(created.success, true, "fixture project must be created");
}

async function seedOrg(
  orgId: string,
  founder: string,
  members: Array<{ id: string; role: "owner" | "member" }> = [],
): Promise<void> {
  await getPlatformStore().orgs.createOrgWithOwner(
    { id: orgId, slug: "acme", name: "Acme", createdBy: founder },
    { actorId: founder },
  );
  for (const m of members) {
    await getPlatformStore().orgs.addMember(orgId, m.id, m.role);
  }
}

describe("document routes", () => {
  beforeEach(async () => {
    await closePlatformStore();
    vi.mocked(getToken).mockReset();
  });
  afterEach(() => closePlatformStore());

  it("401 without a session, on every method", async () => {
    signedInAs(null);
    assert.equal(
      (await LIST_GET(new NextRequest(listUrl(OWNER)), listParams(OWNER)))
        .status,
      401,
    );
    assert.equal(
      (
        await DETAIL_GET(
          new NextRequest(detailUrl(OWNER, KIND, DOC_ID)),
          detailParams(OWNER, KIND, DOC_ID),
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await DETAIL_PUT(
          putReq(OWNER, KIND, DOC_ID, JSON.stringify({ payload: {} })),
          detailParams(OWNER, KIND, DOC_ID),
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await DETAIL_DELETE(
          delReq(OWNER, KIND, DOC_ID),
          detailParams(OWNER, KIND, DOC_ID),
        )
      ).status,
      401,
    );
  });

  it("a stale If-Match returns 409 and the stored document is unchanged", async () => {
    signedInAs(OWNER);
    await DETAIL_PUT(
      putReq(OWNER, KIND, DOC_ID, JSON.stringify({ payload: { v: "first" } })),
      detailParams(OWNER, KIND, DOC_ID),
    );
    // Advance to rev 2.
    await DETAIL_PUT(
      putReq(OWNER, KIND, DOC_ID, JSON.stringify({ payload: { v: "second" } })),
      detailParams(OWNER, KIND, DOC_ID),
    );
    // Stale PUT with If-Match pointing at rev 1.
    const stale = await DETAIL_PUT(
      putReq(OWNER, KIND, DOC_ID, JSON.stringify({ payload: { v: "stale" } }), {
        "If-Match": '"rev:1"',
      }),
      detailParams(OWNER, KIND, DOC_ID),
    );
    assert.equal(stale.status, 409);
    // The stored document must still be the rev-2 payload.
    const fetched = await DETAIL_GET(
      new NextRequest(detailUrl(OWNER, KIND, DOC_ID)),
      detailParams(OWNER, KIND, DOC_ID),
    );
    assert.equal(fetched.status, 200);
    const body = (await fetched.json()) as { payload: { v: string } };
    assert.equal(body.payload.v, "second");
  });

  it("a matching If-Match returns 200 with the next rev in the ETag", async () => {
    signedInAs(OWNER);
    const first = await DETAIL_PUT(
      putReq(OWNER, KIND, DOC_ID, JSON.stringify({ payload: { v: "one" } })),
      detailParams(OWNER, KIND, DOC_ID),
    );
    assert.equal(first.status, 200);
    const etag = first.headers.get("ETag");
    assert.ok(etag, "first PUT must return an ETag");
    const match = /rev:(\d+)/.exec(etag);
    assert.ok(match, "ETag must be rev:<n>");
    const rev = match[1];
    const second = await DETAIL_PUT(
      putReq(OWNER, KIND, DOC_ID, JSON.stringify({ payload: { v: "two" } }), {
        "If-Match": `"rev:${rev}"`,
      }),
      detailParams(OWNER, KIND, DOC_ID),
    );
    assert.equal(second.status, 200);
    const nextEtag = second.headers.get("ETag");
    assert.ok(nextEtag);
    const nextMatch = /rev:(\d+)/.exec(nextEtag);
    assert.ok(nextMatch);
    assert.equal(Number(nextMatch[1]), Number(rev) + 1);
  });

  it("If-Match with no document returns 404", async () => {
    signedInAs(OWNER);
    const res = await DETAIL_PUT(
      putReq(OWNER, KIND, DOC_ID, JSON.stringify({ payload: {} }), {
        "If-Match": '"rev:1"',
      }),
      detailParams(OWNER, KIND, DOC_ID),
    );
    assert.equal(res.status, 404);
    // Nothing must have been written.
    const listed = await LIST_GET(
      new NextRequest(listUrl(OWNER)),
      listParams(OWNER),
    );
    const body = (await listed.json()) as { documents: unknown[] };
    assert.equal(body.documents.length, 0);
  });

  it("a malformed If-Match, and a bare number, return 400", async () => {
    signedInAs(OWNER);
    // Seed a document so the request reaches the If-Match parser.
    await DETAIL_PUT(
      putReq(OWNER, KIND, DOC_ID, JSON.stringify({ payload: {} })),
      detailParams(OWNER, KIND, DOC_ID),
    );

    const malformed = await DETAIL_PUT(
      putReq(OWNER, KIND, DOC_ID, JSON.stringify({ payload: {} }), {
        "If-Match": '"garbage"',
      }),
      detailParams(OWNER, KIND, DOC_ID),
    );
    assert.equal(malformed.status, 400);

    const bare = await DETAIL_PUT(
      putReq(OWNER, KIND, DOC_ID, JSON.stringify({ payload: {} }), {
        "If-Match": "123",
      }),
      detailParams(OWNER, KIND, DOC_ID),
    );
    assert.equal(bare.status, 400);
  });

  it("PUT then GET returns the payload and the ETag of the rev written", async () => {
    signedInAs(OWNER);
    const payload = { text: "hello", nested: { value: 42 } };
    const put = await DETAIL_PUT(
      putReq(OWNER, KIND, DOC_ID, JSON.stringify({ payload })),
      detailParams(OWNER, KIND, DOC_ID),
    );
    assert.equal(put.status, 200);
    const putBody = (await put.json()) as {
      payload: unknown;
      kind: string;
      id: string;
    };
    assert.deepEqual(putBody.payload, payload);
    const etag = put.headers.get("ETag");
    assert.match(etag ?? "", /rev:1/);

    const get = await DETAIL_GET(
      new NextRequest(detailUrl(OWNER, KIND, DOC_ID)),
      detailParams(OWNER, KIND, DOC_ID),
    );
    assert.equal(get.status, 200);
    const getBody = (await get.json()) as { payload: unknown };
    assert.deepEqual(getBody.payload, payload);
    assert.equal(get.headers.get("ETag"), etag);
  });

  it("a user with a write grant on a project gets 403 on list, get, put and delete of the owner's documents", async () => {
    signedInAs(OWNER);
    await seedProject(OWNER);
    await getPlatformStore().shares.grant({
      ownerId: OWNER,
      projectId: PROJECT_ID,
      granteeType: "user",
      granteeId: GRANTEE,
      role: "write",
      grantedBy: OWNER,
    });
    // The grant is real: without this the 403s below would prove nothing.
    assert.equal(
      await getPlatformStore().shares.accessFor(OWNER, PROJECT_ID, {
        userId: GRANTEE,
        orgIds: [],
        teamIds: [],
      }),
      "write",
    );

    signedInAs(GRANTEE);
    assert.equal(
      (await LIST_GET(new NextRequest(listUrl(OWNER)), listParams(OWNER)))
        .status,
      403,
    );
    assert.equal(
      (
        await DETAIL_GET(
          new NextRequest(detailUrl(OWNER, KIND, DOC_ID)),
          detailParams(OWNER, KIND, DOC_ID),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await DETAIL_PUT(
          putReq(OWNER, KIND, DOC_ID, JSON.stringify({ payload: {} })),
          detailParams(OWNER, KIND, DOC_ID),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await DETAIL_DELETE(
          delReq(OWNER, KIND, DOC_ID),
          detailParams(OWNER, KIND, DOC_ID),
        )
      ).status,
      403,
    );
  });

  it("a projectId that names no project in the tenant is 400 and writes nothing", async () => {
    signedInAs(OWNER);
    const res = await DETAIL_PUT(
      putReq(
        OWNER,
        KIND,
        DOC_ID,
        JSON.stringify({
          payload: { v: "attached" },
          projectId: UNKNOWN_PROJECT_ID,
        }),
      ),
      detailParams(OWNER, KIND, DOC_ID),
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { message: string };
    assert.match(body.message, /project in this tenant/i);

    // Nothing must have been written.
    const listed = await LIST_GET(
      new NextRequest(listUrl(OWNER)),
      listParams(OWNER),
    );
    const listBody = (await listed.json()) as { documents: unknown[] };
    assert.equal(listBody.documents.length, 0);
  });

  it("brownfield-draft is refused with 400 on every method", async () => {
    signedInAs(OWNER);

    const listRes = await LIST_GET(
      new NextRequest(`${listUrl(OWNER)}?kind=brownfield-draft`),
      listParams(OWNER),
    );
    assert.equal(listRes.status, 400);

    assert.equal(
      (
        await DETAIL_GET(
          new NextRequest(detailUrl(OWNER, "brownfield-draft", DOC_ID)),
          detailParams(OWNER, "brownfield-draft", DOC_ID),
        )
      ).status,
      400,
    );

    assert.equal(
      (
        await DETAIL_PUT(
          putReq(
            OWNER,
            "brownfield-draft",
            DOC_ID,
            JSON.stringify({ payload: {} }),
          ),
          detailParams(OWNER, "brownfield-draft", DOC_ID),
        )
      ).status,
      400,
    );

    assert.equal(
      (
        await DETAIL_DELETE(
          delReq(OWNER, "brownfield-draft", DOC_ID),
          detailParams(OWNER, "brownfield-draft", DOC_ID),
        )
      ).status,
      400,
    );
  });

  it("a PUT with a projectId attaches the document, and deleting the project through the project route deletes it", async () => {
    signedInAs(OWNER);
    await seedProject(OWNER);

    const put = await DETAIL_PUT(
      putReq(
        OWNER,
        KIND,
        DOC_ID,
        JSON.stringify({ payload: { v: "attached" }, projectId: PROJECT_ID }),
      ),
      detailParams(OWNER, KIND, DOC_ID),
    );
    assert.equal(put.status, 200);
    const putBody = (await put.json()) as { projectId: string | null };
    assert.equal(putBody.projectId, PROJECT_ID);

    // Delete the project through the project route — the FK cascade removes
    // the attached document.
    await PROJECT_DELETE(
      new NextRequest(
        `http://localhost/api/tenants/${OWNER}/projects/${PROJECT_ID}`,
        {
          method: "DELETE",
        },
      ),
      { params: Promise.resolve({ ownerId: OWNER, projectId: PROJECT_ID }) },
    );

    const got = await DETAIL_GET(
      new NextRequest(detailUrl(OWNER, KIND, DOC_ID)),
      detailParams(OWNER, KIND, DOC_ID),
    );
    assert.equal(
      got.status,
      404,
      "deleting the project cascades to its documents",
    );
  });

  it("a second tenant gets 403 and reads nothing", async () => {
    signedInAs(OWNER);
    await DETAIL_PUT(
      putReq(OWNER, KIND, DOC_ID, JSON.stringify({ payload: { v: "A" } })),
      detailParams(OWNER, KIND, DOC_ID),
    );

    signedInAs(USER_B);
    assert.equal(
      (await LIST_GET(new NextRequest(listUrl(OWNER)), listParams(OWNER)))
        .status,
      403,
    );
    assert.equal(
      (
        await DETAIL_GET(
          new NextRequest(detailUrl(OWNER, KIND, DOC_ID)),
          detailParams(OWNER, KIND, DOC_ID),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await DETAIL_PUT(
          putReq(OWNER, KIND, DOC_ID, JSON.stringify({ payload: {} })),
          detailParams(OWNER, KIND, DOC_ID),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await DETAIL_DELETE(
          delReq(OWNER, KIND, DOC_ID),
          detailParams(OWNER, KIND, DOC_ID),
        )
      ).status,
      403,
    );

    // A's document must be unchanged.
    signedInAs(OWNER);
    const fetched = await DETAIL_GET(
      new NextRequest(detailUrl(OWNER, KIND, DOC_ID)),
      detailParams(OWNER, KIND, DOC_ID),
    );
    assert.equal(fetched.status, 200);
    const body = (await fetched.json()) as { payload: { v: string } };
    assert.equal(body.payload.v, "A");
  });

  it("within one org, a second member reads nothing of the first member's documents", async () => {
    await seedOrg(ORG, FOUNDER, [
      { id: MEMBER_A, role: "member" },
      { id: MEMBER_B, role: "member" },
    ]);

    // A puts a document under the org.
    signedInAs(MEMBER_A);
    const put = await DETAIL_PUT(
      putReq(ORG, KIND, DOC_ID, JSON.stringify({ payload: { v: "A" } })),
      detailParams(ORG, KIND, DOC_ID),
    );
    assert.equal(put.status, 200);

    // B sees nothing of A's document.
    signedInAs(MEMBER_B);
    const listed = await LIST_GET(
      new NextRequest(listUrl(ORG)),
      listParams(ORG),
    );
    assert.equal(listed.status, 200);
    const listBody = (await listed.json()) as { documents: unknown[] };
    assert.equal(listBody.documents.length, 0, "B must not list A's document");

    const got = await DETAIL_GET(
      new NextRequest(detailUrl(ORG, KIND, DOC_ID)),
      detailParams(ORG, KIND, DOC_ID),
    );
    assert.equal(got.status, 404, "B must not read A's document");

    const del = await DETAIL_DELETE(
      delReq(ORG, KIND, DOC_ID),
      detailParams(ORG, KIND, DOC_ID),
    );
    assert.equal(
      del.status,
      204,
      "B's delete is idempotent 204 even on A's key",
    );

    // B's PUT of the same kind/id creates B's OWN document, not A's.
    const bPut = await DETAIL_PUT(
      putReq(ORG, KIND, DOC_ID, JSON.stringify({ payload: { v: "B" } })),
      detailParams(ORG, KIND, DOC_ID),
    );
    assert.equal(bPut.status, 200);

    // A's document must be unchanged.
    signedInAs(MEMBER_A);
    const fetched = await DETAIL_GET(
      new NextRequest(detailUrl(ORG, KIND, DOC_ID)),
      detailParams(ORG, KIND, DOC_ID),
    );
    assert.equal(fetched.status, 200);
    const body = (await fetched.json()) as { payload: { v: string } };
    assert.equal(body.payload.v, "A", "A's document must be untouched by B");
  });

  it("a non-member of the org gets 403", async () => {
    await seedOrg(ORG, FOUNDER, [{ id: MEMBER_A, role: "member" }]);

    signedInAs(USER_C);
    assert.equal(
      (await LIST_GET(new NextRequest(listUrl(ORG)), listParams(ORG))).status,
      403,
    );
    assert.equal(
      (
        await DETAIL_GET(
          new NextRequest(detailUrl(ORG, KIND, DOC_ID)),
          detailParams(ORG, KIND, DOC_ID),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await DETAIL_PUT(
          putReq(ORG, KIND, DOC_ID, JSON.stringify({ payload: {} })),
          detailParams(ORG, KIND, DOC_ID),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await DETAIL_DELETE(
          delReq(ORG, KIND, DOC_ID),
          detailParams(ORG, KIND, DOC_ID),
        )
      ).status,
      403,
    );
  });

  it("removing a member deletes that member's documents under the org and nobody else's", async () => {
    await seedOrg(ORG, FOUNDER, [
      { id: MEMBER_A, role: "member" },
      { id: MEMBER_B, role: "member" },
    ]);

    // A and B each put a document under the org.
    signedInAs(MEMBER_A);
    await DETAIL_PUT(
      putReq(ORG, KIND, "doc-a", JSON.stringify({ payload: { v: "A" } })),
      detailParams(ORG, KIND, "doc-a"),
    );

    signedInAs(MEMBER_B);
    await DETAIL_PUT(
      putReq(ORG, KIND, "doc-b", JSON.stringify({ payload: { v: "B" } })),
      detailParams(ORG, KIND, "doc-b"),
    );

    // Remove B — this cascades to B's documents under the org.
    await getPlatformStore().orgs.removeMember(ORG, MEMBER_B, {
      actorId: FOUNDER,
    });

    // A's document must survive.
    signedInAs(MEMBER_A);
    const fetched = await DETAIL_GET(
      new NextRequest(detailUrl(ORG, KIND, "doc-a")),
      detailParams(ORG, KIND, "doc-a"),
    );
    assert.equal(fetched.status, 200, "A's document must survive B's removal");

    // ...and B's are gone. Read through the store: B is no longer a member, so
    // the route would answer 403 whether or not the rows were deleted.
    const left = await getPlatformStore().documentsFor(ORG, MEMBER_B).list();
    assert.equal(left.success, true);
    if (left.success) assert.equal(left.value.length, 0);
  });

  it("an unknown kind or a bad id is 400 and writes nothing", async () => {
    signedInAs(OWNER);

    // Unknown kind
    assert.equal(
      (
        await DETAIL_GET(
          new NextRequest(detailUrl(OWNER, "bogus", DOC_ID)),
          detailParams(OWNER, "bogus", DOC_ID),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await DETAIL_PUT(
          putReq(OWNER, "bogus", DOC_ID, JSON.stringify({ payload: {} })),
          detailParams(OWNER, "bogus", DOC_ID),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await DETAIL_DELETE(
          delReq(OWNER, "bogus", DOC_ID),
          detailParams(OWNER, "bogus", DOC_ID),
        )
      ).status,
      400,
    );

    // Bad id (url has a valid id, params carry the invalid one)
    assert.equal(
      (
        await DETAIL_GET(
          new NextRequest(detailUrl(OWNER, KIND, DOC_ID)),
          detailParams(OWNER, KIND, "has space"),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await DETAIL_PUT(
          putReq(OWNER, KIND, DOC_ID, JSON.stringify({ payload: {} })),
          detailParams(OWNER, KIND, "has space"),
        )
      ).status,
      400,
    );

    // Nothing must have been written.
    const listed = await LIST_GET(
      new NextRequest(listUrl(OWNER)),
      listParams(OWNER),
    );
    const listBody = (await listed.json()) as { documents: unknown[] };
    assert.equal(listBody.documents.length, 0);
  });

  it("a body over the limit is 413 and writes nothing; a body of valid JSON without a payload key is 400", async () => {
    signedInAs(OWNER);

    const overLimit = "x".repeat(DOCUMENT_MAX_PAYLOAD_LENGTH + 2048);
    const bigBody = JSON.stringify({ payload: overLimit });
    assert.ok(bigBody.length > DOCUMENT_MAX_PAYLOAD_LENGTH + 1024);

    const tooLarge = await DETAIL_PUT(
      new NextRequest(detailUrl(OWNER, KIND, DOC_ID), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: bigBody,
      }),
      detailParams(OWNER, KIND, DOC_ID),
    );
    assert.equal(tooLarge.status, 413);
    const largeBody = (await tooLarge.json()) as {
      error: string;
      statusCode: number;
    };
    assert.equal(largeBody.error, "payload_too_large");
    assert.equal(largeBody.statusCode, 413);

    const noPayload = await DETAIL_PUT(
      putReq(OWNER, KIND, DOC_ID, JSON.stringify({ foo: "bar" })),
      detailParams(OWNER, KIND, DOC_ID),
    );
    assert.equal(noPayload.status, 400);

    // Nothing must have been written.
    const listed = await LIST_GET(
      new NextRequest(listUrl(OWNER)),
      listParams(OWNER),
    );
    const listBody = (await listed.json()) as { documents: unknown[] };
    assert.equal(listBody.documents.length, 0);
  });

  it("a cross-origin PUT is refused", async () => {
    signedInAs(OWNER);
    const res = await DETAIL_PUT(
      new NextRequest(detailUrl(OWNER, KIND, DOC_ID), {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "http://evil.example",
          host: "localhost",
        },
        body: JSON.stringify({ payload: {} }),
      }),
      detailParams(OWNER, KIND, DOC_ID),
    );
    assert.equal(res.status, 403);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /cross-origin/i);
  });

  it("DELETE is 204 twice", async () => {
    signedInAs(OWNER);
    await DETAIL_PUT(
      putReq(
        OWNER,
        KIND,
        DOC_ID,
        JSON.stringify({ payload: { v: "to-delete" } }),
      ),
      detailParams(OWNER, KIND, DOC_ID),
    );

    const first = await DETAIL_DELETE(
      delReq(OWNER, KIND, DOC_ID),
      detailParams(OWNER, KIND, DOC_ID),
    );
    assert.equal(first.status, 204);

    const second = await DETAIL_DELETE(
      delReq(OWNER, KIND, DOC_ID),
      detailParams(OWNER, KIND, DOC_ID),
    );
    assert.equal(second.status, 204);

    // Confirm it is gone.
    const got = await DETAIL_GET(
      new NextRequest(detailUrl(OWNER, KIND, DOC_ID)),
      detailParams(OWNER, KIND, DOC_ID),
    );
    assert.equal(got.status, 404);
  });
});
