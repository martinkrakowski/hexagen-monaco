import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  MANIFEST_WRITE_PATH,
  checkMutationAgainstGrant,
  checkWriteAgainstGrant,
  deriveMutationRef,
  type Grant,
} from "../../../src/application/kernel/index.js";
import type { PendingManifestMutation } from "../../../src/application/pending-manifest-mutation.js";

function clientGrant(overrides: Partial<Grant> = {}): Grant {
  return {
    id: "g-client-1",
    principal: "fde",
    agent: "agent-1",
    paths: ["packages/bill/", "docs/NOTES.md"],
    tools: ["edit_file"],
    mode: "write",
    expires_at: "2026-10-02T00:00:00.000Z",
    ...overrides,
  };
}

function denied(result: ReturnType<typeof checkWriteAgainstGrant>) {
  assert.equal(result.allowed, false);
  if (result.allowed) throw new Error("unreachable");
  assert.equal(result.code, "grant_denied");
  return result.reason;
}

describe("checkWriteAgainstGrant", () => {
  it("allows an in-grant tool and paths on a grant with no contexts", () => {
    const result = checkWriteAgainstGrant(clientGrant(), {
      tool: "edit_file",
      paths: ["packages/bill/src/a.ts", "docs/NOTES.md"],
    });
    assert.deepEqual(result, { allowed: true });
  });

  it("denies packages/billing/x against a packages/bill/ grant", () => {
    const reason = denied(
      checkWriteAgainstGrant(clientGrant(), {
        tool: "edit_file",
        paths: ["packages/billing/x"],
      }),
    );
    assert.match(reason, /packages\/billing\/x/);
  });

  it("denies a dot-dot escape", () => {
    const reason = denied(
      checkWriteAgainstGrant(clientGrant(), {
        tool: "edit_file",
        paths: ["packages/bill/../../outside"],
      }),
    );
    assert.match(reason, /packages\/bill\/\.\.\/\.\.\/outside/);
  });

  it("denies a tool not in tools", () => {
    const reason = denied(
      checkWriteAgainstGrant(clientGrant(), {
        tool: "delete_file",
        paths: ["packages/bill/a.ts"],
      }),
    );
    assert.match(reason, /delete_file/);
  });

  it("treats an entry without a trailing slash as an exact path", () => {
    const reason = denied(
      checkWriteAgainstGrant(clientGrant(), {
        tool: "edit_file",
        paths: ["docs/NOTES.md.bak"],
      }),
    );
    assert.match(reason, /docs\/NOTES\.md\.bak/);
  });

  it("is case-sensitive", () => {
    denied(
      checkWriteAgainstGrant(clientGrant(), {
        tool: "edit_file",
        paths: ["Packages/bill/a.ts"],
      }),
    );
  });

  it("denies empty paths", () => {
    denied(
      checkWriteAgainstGrant(clientGrant(), { tool: "edit_file", paths: [] }),
    );
  });

  it("names the first offending path when several are given", () => {
    const reason = denied(
      checkWriteAgainstGrant(clientGrant(), {
        tool: "edit_file",
        paths: ["packages/bill/ok.ts", "etc/first", "etc/second"],
      }),
    );
    assert.match(reason, /etc\/first/);
    assert.doesNotMatch(reason, /etc\/second/);
  });
});

describe("checkWriteAgainstGrant ordering and strictness", () => {
  it("compares tools case-sensitively", () => {
    const reason = denied(
      checkWriteAgainstGrant(clientGrant(), {
        tool: "Edit_File",
        paths: ["packages/bill/a.ts"],
      }),
    );
    assert.match(reason, /Edit_File/);
  });

  it("checks the tool before the empty-paths rule", () => {
    const reason = denied(
      checkWriteAgainstGrant(clientGrant(), { tool: "delete_file", paths: [] }),
    );
    assert.match(reason, /delete_file/);
    assert.doesNotMatch(reason, /No paths/);
  });

  it("checks the tool before the paths", () => {
    const reason = denied(
      checkWriteAgainstGrant(clientGrant(), {
        tool: "delete_file",
        paths: ["etc/x"],
      }),
    );
    assert.match(reason, /delete_file/);
    assert.doesNotMatch(reason, /etc\/x/);
  });

  it("refuses a directory-shaped write target", () => {
    const reason = denied(
      checkWriteAgainstGrant(clientGrant(), {
        tool: "edit_file",
        paths: ["packages/bill/"],
      }),
    );
    assert.match(reason, /directory/);
    assert.match(reason, /packages\/bill\//);
  });
});

describe("checkMutationAgainstGrant with contexts absent", () => {
  it("denies without throwing", () => {
    const pending = {
      kind: "create-context",
      input: { name: "billing" },
    } as unknown as PendingManifestMutation;
    const result = checkMutationAgainstGrant(
      clientGrant({
        tools: ["hexagen_create_context"],
        paths: [MANIFEST_WRITE_PATH],
      }),
      deriveMutationRef(pending),
      pending,
    );
    assert.equal(result.allowed, false);
    if (result.allowed) throw new Error("unreachable");
    assert.match(result.reason, /context 'billing'/);
  });
});
