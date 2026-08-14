import { describe, it } from "vitest";
import assert from "node:assert/strict";

import { mapGithubPublishFailure } from "./github-publish-errors";

describe("mapGithubPublishFailure", () => {
  it("passes the server's user-ready message through for workflow_scope_required", () => {
    assert.deepEqual(
      mapGithubPublishFailure(
        {
          kind: "http-error",
          status: 403,
          message: "Reconnect GitHub to grant workflow permission, then retry.",
          code: "workflow_scope_required",
        },
        "publish",
      ),
      {
        message: "Reconnect GitHub to grant workflow permission, then retry.",
        code: "workflow_scope_required",
      },
    );
  });

  it("maps an explicit reauth_required code to the session-expired copy", () => {
    assert.deepEqual(
      mapGithubPublishFailure(
        {
          kind: "http-error",
          status: 401,
          message: "GitHub session expired or token revoked.",
          code: "reauth_required",
        },
        "push",
      ),
      {
        message: "GitHub session expired — sign in again to push.",
        code: "reauth_required",
      },
    );
  });

  it("treats a codeless 401 as reauth_required (preserves the pre-code client behavior) — publish copy", () => {
    assert.deepEqual(
      mapGithubPublishFailure(
        { kind: "http-error", status: 401, message: "Unauthorized" },
        "publish",
      ),
      {
        message: "GitHub session expired — sign in again to publish.",
        code: "reauth_required",
      },
    );
  });

  it("treats a codeless 401 as reauth_required — push copy", () => {
    assert.deepEqual(
      mapGithubPublishFailure(
        { kind: "http-error", status: 401, message: "Unauthorized" },
        "push",
      ),
      {
        message: "GitHub session expired — sign in again to push.",
        code: "reauth_required",
      },
    );
  });

  it("leaves a codeless 403 unmapped (raw message, null code)", () => {
    assert.deepEqual(
      mapGithubPublishFailure(
        { kind: "http-error", status: 403, message: "Forbidden" },
        "publish",
      ),
      { message: "Forbidden", code: null },
    );
  });

  it("does not treat kebab-case writer codes passed through on 500s as actionable", () => {
    // "conflict" is a RepositoryWriterPort code the push route forwards
    // verbatim inside a 500 body — it is NOT part of the snake_case HTTP
    // vocabulary and must not trigger the Reconnect UI.
    assert.deepEqual(
      mapGithubPublishFailure(
        {
          kind: "http-error",
          status: 500,
          message: "The branch moved since the base commit.",
          code: "conflict",
        },
        "push",
      ),
      { message: "The branch moved since the base commit.", code: null },
    );
  });

  it("maps network-error to the raw message with null code", () => {
    assert.deepEqual(
      mapGithubPublishFailure(
        { kind: "network-error", message: "Failed to fetch" },
        "publish",
      ),
      { message: "Failed to fetch", code: null },
    );
  });

  it("maps parse-error to the raw message with null code", () => {
    assert.deepEqual(
      mapGithubPublishFailure(
        { kind: "parse-error", message: "Invalid JSON response" },
        "push",
      ),
      { message: "Invalid JSON response", code: null },
    );
  });
});
