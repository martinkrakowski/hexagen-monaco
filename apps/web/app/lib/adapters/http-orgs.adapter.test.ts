import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { HttpOrgsAdapter, ORG_SLUG_PATTERN } from "./http-orgs.adapter";

type RecordedCall = { url: string; init: RequestInit | undefined };

/**
 * Injected fetcher that records every (url, init) pair and answers from the
 * given responder — the RunHistoryPage precedent: assert the positive call
 * happened, THEN assert anything about absence, so the absence assertion can
 * never pass vacuously against a fetch that was never wired.
 */
function recordingFetch(
  respond: (url: string, init?: RequestInit) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("HttpOrgsAdapter", () => {
  it("listOrgs GETs /api/orgs and unwraps the membership list", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse({
        orgs: [{ id: "org-1", slug: "acme", name: "Acme", role: "owner" }],
      }),
    );
    const gateway = new HttpOrgsAdapter(fetchImpl);
    const loaded = await gateway.listOrgs();

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "/api/orgs");
    // No method override: the read stays a safe method so the CSRF helper
    // passes it straight through.
    assert.equal(calls[0]?.init?.method, undefined);
    assert.equal(loaded.success, true);
    if (loaded.success) {
      assert.equal(loaded.value.length, 1);
      assert.equal(loaded.value[0]?.slug, "acme");
      assert.equal(loaded.value[0]?.role, "owner");
    }
  });

  it("createOrg POSTs the slug+name JSON body and returns the created org", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse(
        {
          org: {
            id: "org-1",
            slug: "acme",
            name: "Acme",
            createdBy: "user-1",
            createdAt: "2026-08-25T00:00:00.000Z",
          },
        },
        201,
      ),
    );
    const gateway = new HttpOrgsAdapter(fetchImpl);
    const created = await gateway.createOrg({ slug: "acme", name: "Acme" });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "/api/orgs");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      slug: "acme",
      name: "Acme",
    });
    assert.equal(created.success, true);
    if (created.success) assert.equal(created.value.id, "org-1");
  });

  it("createOrg maps the index-raised 409 to conflict, carrying the server message", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse(
        {
          error: "conflict",
          message: "Org slug 'acme' is already taken.",
          statusCode: 409,
        },
        409,
      ),
    );
    const gateway = new HttpOrgsAdapter(fetchImpl);
    const created = await gateway.createOrg({ slug: "acme", name: "Acme" });

    assert.equal(calls[0]?.init?.method, "POST");
    assert.equal(created.success, false);
    if (!created.success) {
      assert.equal(created.error.kind, "conflict");
      assert.equal(created.error.message, "Org slug 'acme' is already taken.");
    }
  });

  it("deleteOrg maps org_owns_projects to conflict with the blocking count", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse(
        {
          error: "org_owns_projects",
          message: "This org still owns 3 projects. Move or delete them first.",
          projectCount: 3,
          statusCode: 409,
        },
        409,
      ),
    );
    const gateway = new HttpOrgsAdapter(fetchImpl);
    const deleted = await gateway.deleteOrg("org-1");

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "/api/orgs/org-1");
    assert.equal(calls[0]?.init?.method, "DELETE");
    assert.equal(deleted.success, false);
    if (!deleted.success) {
      assert.equal(deleted.error.kind, "conflict");
      assert.equal(deleted.error.projectCount, 3);
      assert.match(deleted.error.message, /3 projects/);
    }
  });

  it("maps a 401 refusal to unauthorized", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse(
        { error: "unauthorized", message: "Sign in required", statusCode: 401 },
        401,
      ),
    );
    const gateway = new HttpOrgsAdapter(fetchImpl);
    const loaded = await gateway.listShared();

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "/api/projects/shared");
    assert.equal(loaded.success, false);
    if (!loaded.success) {
      assert.equal(loaded.error.kind, "unauthorized");
      assert.equal(loaded.error.message, "Sign in required");
    }
  });

  it("maps a rejecting fetch to a network error instead of throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const gateway = new HttpOrgsAdapter(fetchImpl);
    const loaded = await gateway.listOrgs();

    assert.equal(loaded.success, false);
    if (!loaded.success) {
      assert.equal(loaded.error.kind, "network");
      assert.ok(loaded.error.cause instanceof TypeError);
    }
  });

  it("inviteMember POSTs the handle+role and models the 202 as an INVITE, never a membership", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse(
        {
          invite: {
            githubLogin: "octocat",
            role: "member",
            expiresAt: "2026-09-01T00:00:00.000Z",
          },
        },
        202,
      ),
    );
    const gateway = new HttpOrgsAdapter(fetchImpl);
    const invited = await gateway.inviteMember("org-1", {
      githubLogin: "octocat",
      role: "member",
    });

    // Positive call first (population guard), then the absence claims.
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "/api/orgs/org-1/members");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      githubLogin: "octocat",
      role: "member",
    });
    assert.equal(invited.success, true);
    if (invited.success) {
      // The value is the pending invite — handle, role and expiry. There is
      // no userId to assert on because nothing addressable exists yet; the
      // membership arrives at the invitee's next sign-in (always-202, D-A4).
      assert.deepEqual(invited.value, {
        githubLogin: "octocat",
        role: "member",
        expiresAt: "2026-09-01T00:00:00.000Z",
      });
      assert.ok(!("userId" in invited.value));
    }
  });

  it("changeRole PATCHes by immutable userId and maps the last-owner 409", async () => {
    const { fetchImpl, calls } = recordingFetch((url, init) =>
      init?.method === "PATCH" && url === "/api/orgs/org-1/members/user-9"
        ? jsonResponse(
            {
              error: "conflict",
              message:
                "This org would be left with no owner. Promote another owner first.",
              statusCode: 409,
            },
            409,
          )
        : jsonResponse({ error: "not_found", statusCode: 404 }, 404),
    );
    const gateway = new HttpOrgsAdapter(fetchImpl);
    const changed = await gateway.changeRole("org-1", "user-9", "member");

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.init?.method, "PATCH");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      role: "member",
    });
    assert.equal(changed.success, false);
    if (!changed.success) {
      assert.equal(changed.error.kind, "conflict");
      assert.match(changed.error.message, /no owner/);
    }
  });

  it("removeTeamMember sends userId as a query param on the DELETE, not a body", async () => {
    const { fetchImpl, calls } = recordingFetch(
      () => new Response(null, { status: 204 }),
    );
    const gateway = new HttpOrgsAdapter(fetchImpl);
    const removed = await gateway.removeTeamMember("org-1", "team-2", "user-3");

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0]?.url,
      "/api/orgs/org-1/teams/team-2/members?userId=user-3",
    );
    assert.equal(calls[0]?.init?.method, "DELETE");
    assert.equal(calls[0]?.init?.body, undefined);
    assert.equal(removed.success, true);
  });

  it("createTeam POSTs into the org's teams collection and unwraps the team", async () => {
    const { fetchImpl, calls } = recordingFetch(() =>
      jsonResponse(
        {
          team: {
            id: "team-2",
            orgId: "org-1",
            slug: "platform",
            name: "Platform",
            createdBy: "user-1",
            createdAt: "2026-08-25T00:00:00.000Z",
          },
        },
        201,
      ),
    );
    const gateway = new HttpOrgsAdapter(fetchImpl);
    const created = await gateway.createTeam("org-1", {
      slug: "platform",
      name: "Platform",
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "/api/orgs/org-1/teams");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
      slug: "platform",
      name: "Platform",
    });
    assert.equal(created.success, true);
    if (created.success) assert.equal(created.value.id, "team-2");
  });

  it("ORG_SLUG_PATTERN mirrors the server rule (client courtesy; the unique index decides)", () => {
    assert.ok(ORG_SLUG_PATTERN.test("acme"));
    assert.ok(ORG_SLUG_PATTERN.test("a1"));
    assert.ok(ORG_SLUG_PATTERN.test("my-org-42"));
    assert.ok(!ORG_SLUG_PATTERN.test("a")); // two chars minimum
    assert.ok(!ORG_SLUG_PATTERN.test("-leading"));
    assert.ok(!ORG_SLUG_PATTERN.test("trailing-"));
    assert.ok(!ORG_SLUG_PATTERN.test("Upper"));
    assert.ok(!ORG_SLUG_PATTERN.test("has/slash"));
    assert.ok(!ORG_SLUG_PATTERN.test("has@at"));
  });
});

describe("response-shape refusals (review flags on #662)", () => {
  it("a 200 with the expected key MISSING is an error, not an empty list", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ unexpected: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const adapter = new HttpOrgsAdapter(fetchImpl);
    const result = await adapter.listOrgs();
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.kind, "unknown");
      assert.match(result.error.message, /orgs/);
    }
  });

  it("invalid JSON from a 200 is 'unknown', not 'network'", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("<!doctype html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ) as unknown as typeof fetch;
    const adapter = new HttpOrgsAdapter(fetchImpl);
    const result = await adapter.listOrgs();
    assert.equal(result.success, false);
    if (!result.success) {
      assert.equal(result.error.kind, "unknown");
      assert.match(result.error.message, /not valid JSON/);
    }
  });
});
