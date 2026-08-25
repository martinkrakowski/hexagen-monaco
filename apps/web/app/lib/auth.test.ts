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
    const result = await persistGithubLogin(
      "user-1",
      "Ada",
      async (id, login) => {
        calls.push([id, login]);
      },
    );
    assert.equal(result.success, true);
    assert.deepEqual(calls, [["user-1", "Ada"]]);
  });

  it("returns a failed Result when setGithubLogin rejects, so sign-in can continue", async () => {
    const result = await persistGithubLogin("user-1", "ada", async () => {
      throw new Error("UNIQUE constraint failed: users.github_login");
    });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.match(result.error.message, /UNIQUE/);
    }
  });
});
