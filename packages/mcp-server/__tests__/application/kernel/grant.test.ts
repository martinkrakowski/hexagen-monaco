import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  MANIFEST_WRITE_PATH,
  canonicalGrantPayload,
  checkGrantMode,
  checkGrantWindow,
  checkMutationAgainstGrant,
  deriveMutationRef,
  type Grant,
} from "../../../src/application/kernel/grant.js";
import type { PendingManifestMutation } from "../../../src/application/pending-manifest-mutation.js";

function grant(overrides: Partial<Grant> = {}): Grant {
  return {
    id: "grant-001",
    principal: "martin",
    agent: "agent-1",
    contexts: ["billing"],
    paths: [MANIFEST_WRITE_PATH],
    tools: ["hexagen_create_context"],
    mode: "write",
    expires_at: "2026-09-30T18:00:00.000Z",
    ...overrides,
  };
}

describe("canonicalGrantPayload", () => {
  it("is stable across different property insertion orders", () => {
    const a: Grant = {
      id: "g1",
      principal: "martin",
      agent: "a1",
      contexts: ["billing"],
      paths: [MANIFEST_WRITE_PATH],
      tools: ["hexagen_create_context"],
      mode: "write",
      expires_at: "2026-09-30T18:00:00.000Z",
    };
    const b: Grant = {
      expires_at: "2026-09-30T18:00:00.000Z",
      mode: "write",
      tools: ["hexagen_create_context"],
      paths: [MANIFEST_WRITE_PATH],
      contexts: ["billing"],
      agent: "a1",
      principal: "martin",
      id: "g1",
    };
    assert.equal(canonicalGrantPayload(a), canonicalGrantPayload(b));
  });

  it("excludes the signature field itself, so signing is not self-referential", () => {
    const base = grant({ signature: undefined });
    const signed = grant({ signature: "deadbeef" });
    assert.equal(canonicalGrantPayload(base), canonicalGrantPayload(signed));
  });

  it("changes when any signable field changes", () => {
    const a = canonicalGrantPayload(grant({ contexts: ["billing"] }));
    const b = canonicalGrantPayload(grant({ contexts: ["stripe"] }));
    assert.notEqual(a, b);
  });
});

describe("deriveMutationRef", () => {
  it("maps each PendingManifestMutation kind to its proposing tool and owning context", () => {
    const cases: Array<[PendingManifestMutation, string, string]> = [
      [
        { kind: "create-context", input: { name: "billing", type: "core" } },
        "hexagen_create_context",
        "billing",
      ],
      [
        {
          kind: "scaffold-module",
          input: { name: "billing", layer: "domain" },
        },
        "hexagen_scaffold_module",
        "billing",
      ],
      [
        {
          kind: "add-dependency",
          input: { sourceModule: "billing", targetModule: "shared" },
        },
        "hexagen_add_dependency",
        "billing",
      ],
      [
        {
          kind: "create-port",
          input: { domain_name: "billing", port_name: "P", type: "outbound" },
        },
        "hexagen_create_port",
        "billing",
      ],
      [
        {
          kind: "create-adapter",
          input: { port_name: "P", infrastructure_name: "stripe" },
        },
        "hexagen_create_adapter",
        "stripe",
      ],
      [
        {
          kind: "remove-port",
          input: {
            context_name: "billing",
            port_name: "P",
            direction: "outbound",
          },
        },
        "hexagen_remove_port",
        "billing",
      ],
      [
        { kind: "remove-context", input: { context_name: "billing" } },
        "hexagen_remove_context",
        "billing",
      ],
    ];
    for (const [mutation, tool, context] of cases) {
      const ref = deriveMutationRef(mutation);
      assert.equal(ref.tool, tool);
      assert.equal(ref.context, context);
    }
  });
});

const createContextMutation: PendingManifestMutation = {
  kind: "create-context",
  input: { name: "billing", type: "core" },
};

const createPortMutation: PendingManifestMutation = {
  kind: "create-port",
  input: { domain_name: "billing", port_name: "P", type: "outbound" },
};

const scaffoldModuleMutation: PendingManifestMutation = {
  kind: "scaffold-module",
  input: { name: "billing", layer: "domain" },
};

describe("checkMutationAgainstGrant", () => {
  it("allows when tool, context, and manifest write path are all granted", () => {
    const check = checkMutationAgainstGrant(
      grant(),
      { tool: "hexagen_create_context", context: "billing" },
      createContextMutation,
    );
    assert.equal(check.allowed, true);
  });

  it("denies on tool alone, independent of context/path", () => {
    const check = checkMutationAgainstGrant(
      grant({ tools: ["hexagen_scaffold_module"] }),
      { tool: "hexagen_create_context", context: "billing" },
      createContextMutation,
    );
    assert.equal(check.allowed, false);
  });

  it("an empty contexts list denies every mutation", () => {
    const check = checkMutationAgainstGrant(
      grant({ contexts: [] }),
      { tool: "hexagen_create_context", context: "billing" },
      createContextMutation,
    );
    assert.equal(check.allowed, false);
  });

  it("denies when paths does not cover the manifest write target", () => {
    const check = checkMutationAgainstGrant(
      grant({ paths: ["packages/billing/"] }),
      { tool: "hexagen_create_context", context: "billing" },
      createContextMutation,
    );
    assert.equal(check.allowed, false);
    if (!check.allowed) assert.match(check.reason, /manifest write target/);
  });

  it("denies create-port when the grant covers .architecture/ but not packages/<context>/", () => {
    const check = checkMutationAgainstGrant(
      grant({ tools: ["hexagen_create_port"], paths: [MANIFEST_WRITE_PATH] }),
      { tool: "hexagen_create_port", context: "billing" },
      createPortMutation,
    );
    assert.equal(check.allowed, false);
    if (!check.allowed) assert.match(check.reason, /packages\/billing\//);
  });

  it("allows create-port when the grant covers both .architecture/ and packages/<context>/", () => {
    const check = checkMutationAgainstGrant(
      grant({
        tools: ["hexagen_create_port"],
        paths: [MANIFEST_WRITE_PATH, "packages/billing/"],
      }),
      { tool: "hexagen_create_port", context: "billing" },
      createPortMutation,
    );
    assert.equal(check.allowed, true);
  });

  it("denies scaffold-module when max_files is smaller than its worst-case file count", () => {
    const check = checkMutationAgainstGrant(
      grant({
        tools: ["hexagen_scaffold_module"],
        paths: [MANIFEST_WRITE_PATH, "packages/billing/"],
        max_files: 1,
      }),
      { tool: "hexagen_scaffold_module", context: "billing" },
      scaffoldModuleMutation,
    );
    assert.equal(check.allowed, false);
    if (!check.allowed) assert.match(check.reason, /max_files/);
  });

  it("allows scaffold-module when max_files covers its worst-case file count", () => {
    const check = checkMutationAgainstGrant(
      grant({
        tools: ["hexagen_scaffold_module"],
        paths: [MANIFEST_WRITE_PATH, "packages/billing/"],
        max_files: 4,
      }),
      { tool: "hexagen_scaffold_module", context: "billing" },
      scaffoldModuleMutation,
    );
    assert.equal(check.allowed, true);
  });
});

describe("checkGrantWindow", () => {
  const g = grant({
    expires_at: "2026-09-30T12:00:00.000Z",
    revoked_at: "2026-09-30T10:00:00.000Z",
  });

  it("denies at or after revoked_at", () => {
    assert.equal(
      checkGrantWindow(g, new Date("2026-09-30T10:00:00.000Z")).allowed,
      false,
    );
  });

  it("allows strictly before revoked_at", () => {
    assert.equal(
      checkGrantWindow(g, new Date("2026-09-30T09:59:59.999Z")).allowed,
      true,
    );
  });

  it("allows exactly at expires_at when not revoked", () => {
    const active = grant({ expires_at: "2026-09-30T12:00:00.000Z" });
    assert.equal(
      checkGrantWindow(active, new Date("2026-09-30T12:00:00.000Z")).allowed,
      true,
    );
  });

  it("denies strictly after expires_at", () => {
    const active = grant({ expires_at: "2026-09-30T12:00:00.000Z" });
    assert.equal(
      checkGrantWindow(active, new Date("2026-09-30T12:00:00.001Z")).allowed,
      false,
    );
  });

  it("denies a malformed expires_at instead of treating it as never-expiring", () => {
    const malformed = grant({ expires_at: "not-a-date" });
    const check = checkGrantWindow(
      malformed,
      new Date("2026-09-30T12:00:00.000Z"),
    );
    assert.equal(check.allowed, false);
    if (!check.allowed) assert.match(check.reason, /invalid expires_at/);
  });

  it("denies a malformed revoked_at instead of ignoring it", () => {
    const malformed = grant({
      expires_at: "2026-09-30T18:00:00.000Z",
      revoked_at: "not-a-date",
    });
    const check = checkGrantWindow(
      malformed,
      new Date("2026-09-30T12:00:00.000Z"),
    );
    assert.equal(check.allowed, false);
    if (!check.allowed) assert.match(check.reason, /invalid revoked_at/);
  });
});

describe("checkGrantMode", () => {
  it("allows 'write'", () => {
    assert.equal(checkGrantMode(grant({ mode: "write" })).allowed, true);
  });
  it("denies 'propose'", () => {
    assert.equal(checkGrantMode(grant({ mode: "propose" })).allowed, false);
  });
});
