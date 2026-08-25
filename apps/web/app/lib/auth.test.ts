import { describe, it } from "vitest";
import assert from "node:assert/strict";

// Importing the real authOptions (not a mock) is safe here: GITHUB_ID and
// GITHUB_SECRET default to "" in auth.ts, so no env is required at module
// load. No other test pins the requested scope — this closes that gap.
import { authOptions, persistGithubLogin } from "./auth";

describe("authOptions GitHub provider", () => {
  it("requests both repo and workflow scopes", () => {
    const provider = authOptions.providers[0];
    assert.equal(provider.id, "github");
    if (provider.type !== "oauth") {
      assert.fail("expected the GitHub provider to be an OAuth provider");
    }

    // NextAuth v4 provider factories return their built-in defaults at the
    // top level and stash the user-supplied config under `options`, merging
    // the two at runtime — so the requested scope lives at
    // provider.options.authorization.params.scope, NOT provider.authorization
    // (which holds the default "read:user user:email").
    const authorization = provider.options?.authorization;
    if (typeof authorization !== "object" || authorization === null) {
      assert.fail("expected an authorization object with explicit params");
    }
    const scope = authorization.params?.scope;
    assert.equal(typeof scope, "string");

    // Exact-token membership (not substring matching) so e.g. a hypothetical
    // "workflows" scope could not satisfy the "workflow" assertion.
    const scopes = String(scope).split(/\s+/);
    assert.ok(scopes.includes("repo"), `scope "${scope}" is missing "repo"`);
    assert.ok(
      scopes.includes("workflow"),
      `scope "${scope}" is missing "workflow" — published trees may contain .github/workflows/*`,
    );
  });

  it("keeps JWT sessions and a dedicated sign-in page", () => {
    assert.equal(authOptions.session?.strategy, "jwt");
    assert.equal(authOptions.pages?.signIn, "/auth/signin");
    assert.ok(authOptions.adapter);
  });
});

describe("persistGithubLogin", () => {
  it("returns success when the repository write lands", async () => {
    const calls: Array<[string, string]> = [];
    const result = await persistGithubLogin("user-1", "Ada", {
      setLogin: async (id, login) => {
        calls.push([id, login]);
      },
      acceptInvites: async () => [],
    });
    assert.equal(result.success, true);
    assert.deepEqual(calls, [["user-1", "Ada"]]);
  });

  it("returns a failed Result when setGithubLogin rejects, so sign-in can continue", async () => {
    const result = await persistGithubLogin("user-1", "ada", {
      setLogin: async () => {
        throw new Error("UNIQUE constraint failed: users.github_login");
      },
      acceptInvites: async () => [],
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.match(result.error.message, /UNIQUE/);
    }
  });

  it("redeems invites AFTER the handle is stored, and reports the orgs joined", async () => {
    // Ordering is the assertion, not an incidental detail: acceptance keys off
    // the login, so a reversal would let a membership exist for a handle the
    // `users` row never recorded.
    const order: string[] = [];
    const result = await persistGithubLogin("user-1", "Ada", {
      setLogin: async () => {
        order.push("setLogin");
      },
      acceptInvites: async (id, login) => {
        order.push(`accept:${id}:${login}`);
        return ["org-acme"];
      },
    });
    assert.deepEqual(order, ["setLogin", "accept:user-1:Ada"]);
    assert.equal(result.success, true);
    if (result.success) assert.deepEqual(result.value, ["org-acme"]);
  });

  it("does not attempt acceptance when the handle write failed", async () => {
    // Otherwise a user whose login never persisted could still be joined to an
    // org by a stale invite, and nothing would record which handle did it.
    let accepted = false;
    const result = await persistGithubLogin("user-1", "ada", {
      setLogin: async () => {
        throw new Error("disk full");
      },
      acceptInvites: async () => {
        accepted = true;
        return ["org-acme"];
      },
    });
    assert.equal(result.success, false);
    assert.equal(accepted, false);
  });

  it("surfaces an acceptance failure as a failed Result, so sign-in still completes", async () => {
    const result = await persistGithubLogin("user-1", "ada", {
      setLogin: async () => {},
      acceptInvites: async () => {
        throw new Error("database is locked");
      },
    });
    assert.equal(result.success, false);
    if (!result.success) assert.match(result.error.message, /locked/);
  });
});
