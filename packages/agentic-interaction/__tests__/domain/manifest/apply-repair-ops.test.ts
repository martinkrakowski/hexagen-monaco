import { test, describe } from "node:test";
import assert from "node:assert";
import {
  parseRepairOps,
  applyManifestOps,
  type ManifestObject,
} from "../../../src/domain/manifest/apply-repair-ops";

// Follow-up C: the reviewer emits a small typed op-list applied deterministically,
// instead of re-emitting the whole manifest (which faithfully reproduced ~2k
// tokens but dropped the small edits the findings called for — RCA §8).

const base = (): ManifestObject => ({
  bounded_contexts: [
    {
      name: "identity-access",
      depends_on: ["payment-gateway"],
      layers: {
        application: {
          ports: {
            in: ["RegisterUserPort", "AuthenticateUserPort"],
            out: ["AuditLogPort"],
          },
        },
        infrastructure: { adapters: ["AuditLogAdapter"] },
      },
    },
    {
      name: "payment-gateway",
      layers: {
        application: { ports: { in: ["ProcessPaymentPort"], out: [] } },
        infrastructure: { adapters: [] },
      },
    },
  ],
  context_mappings: [
    { upstream: "payment-gateway", downstream: "identity-access" },
  ],
});

const ctxOf = (m: ManifestObject, name: string) =>
  m.bounded_contexts?.find((c) => c.name === name);

describe("parseRepairOps", () => {
  test("parses a clean JSON op-list", () => {
    const { ops, rejected } = parseRepairOps(
      '[{"op":"add-out-port","context":"x","name":"FooRepositoryPort"}]',
    );
    assert.strictEqual(ops.length, 1);
    assert.deepStrictEqual(rejected, []);
  });

  test("tolerates a prose preamble and code fences around the array", () => {
    const { ops } = parseRepairOps(
      'Here are the edits:\n```json\n[{"op":"add-adapter","context":"x","name":"A"}]\n```\nDone.',
    );
    assert.strictEqual(ops.length, 1);
    assert.strictEqual(ops[0].op, "add-adapter");
  });

  test("keeps valid ops and reports the invalid ones", () => {
    const { ops, rejected } = parseRepairOps(
      '[{"op":"add-out-port","context":"x","name":"F"},{"op":"nonsense"},{"op":"add-adapter"}]',
    );
    assert.strictEqual(ops.length, 1);
    assert.strictEqual(rejected.length, 2);
  });

  test("no array / unparseable → no ops, reported", () => {
    assert.deepStrictEqual(parseRepairOps("").rejected, []);
    assert.strictEqual(parseRepairOps('{"op":"x"}').ops.length, 0);
    assert.strictEqual(parseRepairOps("[not json]").ops.length, 0);
  });
});

describe("applyManifestOps", () => {
  test("add-out-port / add-adapter add a bare name and count as applied", () => {
    const r = applyManifestOps(base(), [
      {
        op: "add-out-port",
        context: "identity-access",
        name: "UserRepositoryPort",
      },
      {
        op: "add-adapter",
        context: "identity-access",
        name: "RegisterUserAdapter",
      },
    ]);
    assert.strictEqual(r.applied, 2);
    assert.deepStrictEqual(r.skipped, []);
    const ctx = ctxOf(r.manifest, "identity-access");
    assert.ok(
      ctx?.layers?.application?.ports?.out?.includes("UserRepositoryPort"),
    );
    assert.ok(
      ctx?.layers?.infrastructure?.adapters?.includes("RegisterUserAdapter"),
    );
  });

  test("a duplicate add is skipped (reported), not double-added", () => {
    const r = applyManifestOps(base(), [
      { op: "add-out-port", context: "identity-access", name: "AuditLogPort" },
    ]);
    assert.strictEqual(r.applied, 0);
    assert.strictEqual(r.skipped.length, 1);
    assert.match(r.skipped[0].reason, /already present/);
  });

  test("an unknown context is skipped (reported)", () => {
    const r = applyManifestOps(base(), [
      { op: "add-adapter", context: "ghost", name: "X" },
    ]);
    assert.strictEqual(r.applied, 0);
    assert.match(r.skipped[0].reason, /not found/);
  });

  test("rename-port rewrites the name in the in/out lists", () => {
    const r = applyManifestOps(base(), [
      {
        op: "rename-port",
        context: "identity-access",
        from: "RegisterUserPort",
        to: "RegisterMemberPort",
      },
    ]);
    const inPorts = ctxOf(r.manifest, "identity-access")?.layers?.application
      ?.ports?.in;
    assert.ok(inPorts?.includes("RegisterMemberPort"));
    assert.ok(!inPorts?.includes("RegisterUserPort"));
  });

  test("rename-context renames the context AND its mapping + depends_on references", () => {
    const r = applyManifestOps(base(), [
      { op: "rename-context", from: "payment-gateway", to: "billing" },
    ]);
    assert.strictEqual(r.applied, 1);
    assert.ok(ctxOf(r.manifest, "billing"), "context renamed");
    assert.strictEqual(r.manifest.context_mappings?.[0].upstream, "billing");
    assert.deepStrictEqual(ctxOf(r.manifest, "identity-access")?.depends_on, [
      "billing",
    ]);
  });

  test("does NOT mutate the input manifest (the fail-safe original)", () => {
    const input = base();
    applyManifestOps(input, [
      { op: "add-out-port", context: "identity-access", name: "NewPort" },
      { op: "rename-context", from: "payment-gateway", to: "billing" },
    ]);
    assert.deepStrictEqual(
      ctxOf(input, "identity-access")?.layers?.application?.ports?.out,
      ["AuditLogPort"],
    );
    assert.ok(ctxOf(input, "payment-gateway"), "original context name intact");
  });
});
