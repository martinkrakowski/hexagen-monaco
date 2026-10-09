// @vitest-environment node
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  BACKENDS,
  openBackend,
  type BackendKind,
} from "../../../test-support/platform-backends";
import { openPlatformDb } from "../platform-db";
import { createSqlitePlatformDb } from "../sqlite-db";
import { canAutoFix, type ViolationCode } from "@hexagen/manifest-generation";
import {
  MAX_REPAIR_RUNS_PER_OWNER,
  REPAIR_VIOLATION_CLASSES,
  classifyFinding,
  classifyViolation,
  createRepairTelemetryStore,
  isDeterministicallyEligible,
  type RecordRepairAttemptInput,
  type RecordRepairRunInput,
} from "../repair-telemetry-store";

// The store is intentionally NOT reachable from createPlatformStore yet: this
// packet lands the schema only, and wiring it into PlatformStore would be a
// call-site change. Suites open the db directly, in-memory, per the
// run-history-store convention.
async function openStore(kind: BackendKind, ownerId = "owner-a") {
  const backend = await openBackend(kind);
  return {
    backend,
    db: backend.db,
    store: createRepairTelemetryStore(backend.db, ownerId),
  };
}

/** The value of a successful result; fails the test, with the error, when it is not one. */
function must<T>(
  r: { success: true; value: T } | { success: false; error: unknown },
): T {
  if (!r.success)
    throw new Error(`expected success, got ${JSON.stringify(r.error)}`);
  return r.value;
}

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_RUN_ID = "22222222-2222-4222-8222-222222222222";

function attempt(
  over: Partial<RecordRepairAttemptInput> = {},
): RecordRepairAttemptInput {
  return {
    round: 1,
    seq: 0,
    violationClass: "client-scope-missing",
    violationStatus: "fail",
    path: "deterministic",
    eligible: true,
    applied: true,
    changedYaml: true,
    durationMs: 3,
    ...over,
  };
}

function run(over: Partial<RecordRepairRunInput> = {}): RecordRepairRunInput {
  return {
    runId: RUN_ID,
    surface: "client-deterministic",
    outcome: "deterministic-fixed",
    rounds: 1,
    violationsInitial: 1,
    violationsRemaining: 0,
    durationMs: 12,
    attempts: [attempt()],
    now: Date.UTC(2026, 7, 20, 12, 0, 0),
    ...over,
  };
}

/**
 * The load-bearing test of the packet. `classifyViolation` exists so that the
 * user's context names -- which manifest-view-data-parser interpolates STRAIGHT
 * INTO `ValidationItem.title` -- never reach the database. That is only true if
 * the classifier agrees with `canAutoFix` on every branch; a disagreement means
 * either a row claiming eligibility it never had, or a class that silently
 * lumps an eligible violation with an ineligible one.
 */
describe("classifyViolation mirrors canAutoFix", () => {
  // P0 (2026-08-23) made `code` the fixer's contract; title/description are
  // display-only. Cases the parser really emits carry their code and still
  // cross-check canAutoFix; shapes the parser never emits (the classifier's
  // `-other` / `unclassified` probes) have no canAutoFix ground truth any
  // more and are asserted ineligible directly.
  const cases: Array<{
    title: string;
    description: string;
    code?: ViolationCode;
  }> = [
    {
      title: "Invalid YAML",
      description: "bad indent at line 4",
      code: "invalid-yaml",
    },
    {
      title: "Scope Missing",
      description: "No scope declared",
      code: "scope-missing",
    },
    {
      title: "Architecture Missing",
      description: "No architecture declared",
      code: "architecture-missing",
    },
    {
      title: "Minimum Interface Contract",
      description: "2 contexts are missing ports",
      code: "interface-contract-missing-ports",
    },
    {
      title: "Minimum Interface Contract",
      description: "all contexts satisfy the contract",
      code: "interface-contract-met",
    },
    // Real parser output interpolates the user's context name into the title.
    {
      title: 'Context Name "-billing"',
      description: "Starts with hyphen",
      code: "context-name-hyphen",
    },
    { title: 'Context Name "Billing"', description: "Looks fine" },
    {
      title: 'YAML Tag Indicator "!" in Names',
      description: 'Port name contains "!"',
      code: "yaml-tag-indicator",
    },
    {
      title: "Some Other Title",
      description: "Adapter has a YAML tag indicator",
      code: "yaml-tag-indicator",
    },
    {
      title: "Billing: Zero Adapters",
      description: "0 adapters declared",
      code: "zero-adapters",
    },
    {
      title: "Billing: 3 Unconnected Ports",
      description: "3 outbound ports have no adapter",
      code: "unconnected-ports",
    },
    { title: "Description Quality", description: "too short" },
  ];

  it("returns a member of the closed class set for every case", () => {
    for (const item of cases) {
      const cls = classifyViolation(item);
      assert.ok(
        (REPAIR_VIOLATION_CLASSES as readonly string[]).includes(cls),
        `${item.title} -> ${cls} is outside the closed set`,
      );
    }
  });

  it("agrees with canAutoFix on eligibility for every case", () => {
    for (const item of cases) {
      const actual = isDeterministicallyEligible(classifyViolation(item));
      if (item.code !== undefined) {
        const expected = canAutoFix({
          status: "fail",
          code: item.code,
          title: item.title,
          description: item.description,
        });
        assert.equal(
          actual,
          expected,
          `eligibility drift for ${JSON.stringify(item.title)}`,
        );
      } else {
        // Never emitted by the parser: no code exists, so the fixer can never
        // see it; the classifier must not claim eligibility for it either.
        assert.equal(
          actual,
          false,
          `uncoded shape claims eligibility: ${JSON.stringify(item.title)}`,
        );
      }
    }
  });

  it("distinguishes the eligible sub-case from the ineligible one", () => {
    // These two share a title. If the class collapsed them, `eligible` would
    // depend on description text the row deliberately does not carry.
    assert.notEqual(
      classifyViolation({
        title: "Minimum Interface Contract",
        description: "missing ports",
      }),
      classifyViolation({
        title: "Minimum Interface Contract",
        description: "fine",
      }),
    );
    assert.notEqual(
      classifyViolation({
        title: 'Context Name "-x"',
        description: "Starts with hyphen",
      }),
      classifyViolation({
        title: 'Context Name "X"',
        description: "ok",
      }),
    );
  });

  it("carries no fragment of the title or description into the class", () => {
    const cls = classifyViolation({
      title: 'Context Name "SecretInternalBillingContext"',
      description: 'Starts with hyphen; port "SecretPort" affected',
    });
    assert.equal(cls, "client-context-name-hyphen");
    assert.ok(!cls.includes("Secret"));
    assert.ok(!cls.includes("Billing"));
  });

  it("survives malformed input without throwing", () => {
    const loose = classifyViolation as unknown as (v: unknown) => string;
    assert.equal(loose({}), "unclassified");
    assert.equal(loose({ title: 5, description: null }), "unclassified");
  });
});

describe("classifyFinding", () => {
  it("anchors the rule tag at the start", () => {
    assert.equal(
      classifyFinding("[R03] context has no repository port"),
      "R03",
    );
    // Unanchored matching would misfile this as R16.
    assert.equal(
      classifyFinding("[R03] see also the R16 description rule"),
      "R03",
    );
  });

  it("falls back to unclassified rather than keeping the text", () => {
    assert.equal(classifyFinding("no tag here at all"), "unclassified");
    assert.equal(classifyFinding("[R99] out of range"), "unclassified");
    assert.equal(
      (classifyFinding as unknown as (v: unknown) => string)(undefined),
      "unclassified",
    );
  });
});

describe.each(BACKENDS)("repair telemetry store (%s)", (kind) => {
  it("persists a run and its attempts together", async () => {
    const { backend, store } = await openStore(kind);
    try {
      const written = await store.record(run());
      assert.equal(written.success, true);
      assert.ok(written.success && written.value.attemptsTotal === 1);
      assert.ok(written.success && written.value.attemptsApplied === 1);

      const runs = await store.listRuns();
      assert.equal(runs.success && runs.value.length, 1);
      assert.equal(
        runs.success && runs.value[0]?.outcome,
        "deterministic-fixed",
      );

      const attempts = await store.listAttempts(RUN_ID);
      assert.equal(attempts.success && attempts.value.length, 1);
      assert.equal(
        attempts.success && attempts.value[0]?.violationClass,
        "client-scope-missing",
      );
    } finally {
      await backend.close();
    }
  });

  it("scopes rows to the owner", async () => {
    const backend = await openBackend(kind);
    try {
      const a = createRepairTelemetryStore(backend.db, "owner-a");
      const b = createRepairTelemetryStore(backend.db, "owner-b");
      assert.equal((await a.record(run())).success, true);
      const seen = await b.listRuns();
      assert.equal(seen.success && seen.value.length, 0);
    } finally {
      await backend.close();
    }
  });

  it("records eligible-but-unapplied as its own state", async () => {
    const { backend, store } = await openStore(kind);
    try {
      await store.record(
        run({
          outcome: "unfixable",
          violationsRemaining: 1,
          attempts: [
            attempt({
              violationClass: "client-zero-adapters",
              eligible: true,
              applied: false,
              changedYaml: false,
            }),
          ],
        }),
      );
      const attempts = await store.listAttempts(RUN_ID);
      const row = attempts.success ? attempts.value[0] : undefined;
      assert.equal(row?.eligible, true);
      assert.equal(row?.applied, false);
      assert.equal(row?.changedYaml, false);
    } finally {
      await backend.close();
    }
  });

  it("keeps unfixable and abandoned distinguishable", async () => {
    const { backend, store } = await openStore(kind);
    try {
      await store.record(run({ runId: RUN_ID, outcome: "unfixable" }));
      await store.record(run({ runId: OTHER_RUN_ID, outcome: "abandoned" }));
      const runs = await store.listRuns();
      const outcomes = runs.success
        ? runs.value.map((r) => r.outcome).sort()
        : [];
      assert.deepEqual(outcomes, ["abandoned", "unfixable"]);
    } finally {
      await backend.close();
    }
  });

  it("upserts on (owner, run_id) so a reconnect does not double-count", async () => {
    const { backend, store } = await openStore(kind);
    try {
      const first = await store.record(run({ rounds: 1 }));
      const second = await store.record(run({ rounds: 4, durationMs: 900 }));
      const runs = await store.listRuns();
      assert.equal(runs.success && runs.value.length, 1);
      assert.equal(runs.success && runs.value[0]?.rounds, 4);
      assert.equal(runs.success && runs.value[0]?.durationMs, 900);
      assert.equal(
        first.success && second.success && second.value.id,
        first.success ? first.value.id : undefined,
      );
      assert.equal(
        runs.success && runs.value[0]?.id,
        first.success ? first.value.id : undefined,
      );
    } finally {
      await backend.close();
    }
  });

  it("replaces the attempt set wholesale on re-record", async () => {
    const { backend, store } = await openStore(kind);
    try {
      await store.record(
        run({
          attempts: [
            attempt({ round: 1, seq: 0 }),
            attempt({ round: 2, seq: 0 }),
            attempt({ round: 3, seq: 0 }),
          ],
        }),
      );
      await store.record(run({ attempts: [attempt({ round: 1, seq: 0 })] }));
      const attempts = await store.listAttempts(RUN_ID);
      assert.equal(attempts.success && attempts.value.length, 1);
      const runs = await store.listRuns();
      assert.equal(runs.success && runs.value[0]?.attemptsTotal, 1);
    } finally {
      await backend.close();
    }
  });

  it("rejects a non-opaque run id instead of storing it", async () => {
    const { backend, store } = await openStore(kind);
    try {
      const bad = await store.record(run({ runId: "acme/billing-service" }));
      assert.equal(bad.success, false);
      assert.ok(!bad.success && !bad.error.message.includes("acme"));
      const runs = await store.listRuns();
      assert.ok(runs.success, "listRuns succeeds after a rejected record");
      assert.equal(runs.value.length, 0);
    } finally {
      await backend.close();
    }
  });

  it("rejects unknown enum values rather than coercing them", async () => {
    const { backend, store } = await openStore(kind);
    try {
      const loose = store.record as unknown as (
        i: Record<string, unknown>,
      ) => Promise<{ success: boolean }>;
      assert.equal(
        (await loose({ ...run(), surface: "smuggled-text" })).success,
        false,
      );
      assert.equal(
        (await loose({ ...run(), outcome: "probably-fine" })).success,
        false,
      );
      assert.equal(
        (
          await loose({
            ...run(),
            attempts: [
              { ...attempt(), violationClass: 'Context Name "Billing"' },
            ],
          })
        ).success,
        false,
      );
      assert.equal(
        (
          await loose({
            ...run(),
            attempts: [{ ...attempt(), path: "magic" }],
          })
        ).success,
        false,
      );
      assert.equal(
        (
          await loose({
            ...run(),
            attempts: [{ ...attempt(), gateReason: "because" }],
          })
        ).success,
        false,
      );
    } finally {
      await backend.close();
    }
  });

  it("rejects a duplicate round/seq pair rather than losing an attempt", async () => {
    const { backend, store } = await openStore(kind);
    try {
      const dup = await store.record({
        ...run(),
        attempts: [
          attempt({ round: 1, seq: 0 }),
          attempt({ round: 1, seq: 0 }),
        ],
      });
      assert.equal(dup.success, false);
    } finally {
      await backend.close();
    }
  });

  it("aggregates per violation class with a median duration", async () => {
    const { backend, store } = await openStore(kind);
    try {
      await store.record(
        run({
          attempts: [
            attempt({
              round: 1,
              seq: 0,
              violationClass: "client-zero-adapters",
              durationMs: 1,
              applied: true,
            }),
            attempt({
              round: 1,
              seq: 1,
              violationClass: "client-zero-adapters",
              durationMs: 5,
              applied: false,
            }),
            attempt({
              round: 1,
              seq: 2,
              violationClass: "client-zero-adapters",
              durationMs: 30000,
              applied: false,
            }),
            attempt({
              round: 2,
              seq: 0,
              violationClass: "R03",
              eligible: false,
              path: "llm-ops",
              durationMs: 4200,
              opsProposed: 3,
              opsApplied: 2,
              opsSkipped: 1,
              gateReason: "applied",
            }),
          ],
        }),
      );
      const stats = await store.classStats();
      assert.ok(stats.success);
      const byClass = new Map(
        (stats.success ? stats.value : []).map((s) => [s.violationClass, s]),
      );
      const zero = byClass.get("client-zero-adapters");
      assert.equal(zero?.attempts, 3);
      assert.equal(zero?.eligible, 3);
      assert.equal(zero?.applied, 1);
      assert.equal(zero?.medianDurationMs, 5);
      const r03 = byClass.get("R03");
      assert.equal(r03?.attempts, 1);
      assert.equal(r03?.eligible, 0);
    } finally {
      await backend.close();
    }
  });

  it("filters class stats by surface", async () => {
    const { backend, store } = await openStore(kind);
    try {
      await store.record(
        run({ runId: RUN_ID, surface: "client-deterministic" }),
      );
      await store.record(
        run({
          runId: OTHER_RUN_ID,
          surface: "server-staged",
          outcome: "llm-fixed",
          attempts: [
            attempt({
              violationClass: "R05",
              path: "llm-ops",
              eligible: false,
            }),
          ],
        }),
      );
      const server = await store.classStats({ surface: "server-staged" });
      assert.ok(server.success);
      assert.deepEqual(
        server.success ? server.value.map((s) => s.violationClass) : [],
        ["R05"],
      );
    } finally {
      await backend.close();
    }
  });

  it("evicts the oldest runs and their attempts past the per-owner cap", async () => {
    const { backend, db, store } = await openStore(kind);
    try {
      const total = MAX_REPAIR_RUNS_PER_OWNER + 3;
      for (let i = 0; i < total; i++) {
        const id = `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`;
        await store.record(run({ runId: id, now: 1_700_000_000_000 + i }));
      }
      const runs = await store.listRuns({ limit: MAX_REPAIR_RUNS_PER_OWNER });
      assert.equal(
        runs.success && runs.value.length,
        MAX_REPAIR_RUNS_PER_OWNER,
      );
      const orphans = await db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM repair_attempts a
          WHERE NOT EXISTS (
            SELECT 1 FROM repair_runs r
             WHERE r.owner_id = a.owner_id AND r.run_id = a.run_id)`,
      );
      assert.equal(orphans?.n, 0);
    } finally {
      await backend.close();
    }
  }, 120_000); // five hundred transactions on a slow disk.

  it("writes the new run and evicts the oldest with its attempts in one record call", async () => {
    const { backend, db, store } = await openStore(kind);
    try {
      for (let i = 0; i < MAX_REPAIR_RUNS_PER_OWNER; i++) {
        const id = `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`;
        const seeded = await store.record(
          run({ runId: id, now: 1_700_000_000_000 + i }),
        );
        assert.ok(seeded.success, `fixture write ${i} failed`);
      }
      const overwritten = `33333333-3333-4333-8333-000000000000`;

      const overflow = await store.record(
        run({ runId: OTHER_RUN_ID, now: 2_000_000_000_000 }),
      );
      assert.equal(overflow.success, true);

      const runs = await store.listRuns({ limit: MAX_REPAIR_RUNS_PER_OWNER });
      assert.equal(
        runs.success && runs.value.length,
        MAX_REPAIR_RUNS_PER_OWNER,
      );
      assert.equal(runs.success && runs.value[0]?.runId, OTHER_RUN_ID);
      assert.equal(
        runs.success ? runs.value.some((r) => r.runId === overwritten) : false,
        false,
      );
      const orphans = await db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM repair_attempts a
          WHERE NOT EXISTS (
            SELECT 1 FROM repair_runs r
             WHERE r.owner_id = a.owner_id AND r.run_id = a.run_id)`,
      );
      assert.equal(orphans?.n, 0);
    } finally {
      await backend.close();
    }
  }, 120_000); // five hundred transactions on a slow disk.

  it("hides rows written under a foreign schema_version instead of decoding them", async () => {
    const { backend, db, store } = await openStore(kind);
    try {
      assert.equal((await store.record(run())).success, true);
      await db.run("UPDATE repair_runs SET schema_version = 99");
      const runs = await store.listRuns();
      assert.equal(runs.success && runs.value.length, 0);
    } finally {
      await backend.close();
    }
  });

  it("drops a row whose stored enum no longer parses", async () => {
    const { backend, db, store } = await openStore(kind);
    try {
      assert.equal((await store.record(run())).success, true);
      await db.run("UPDATE repair_runs SET outcome = 'from-the-future'");
      const runs = await store.listRuns();
      assert.equal(runs.success && runs.value.length, 0);
    } finally {
      await backend.close();
    }
  });

  it("stores nothing outside the closed value sets", async () => {
    const { backend, db, store } = await openStore(kind);
    try {
      assert.equal((await store.record(run())).success, true);
      const allowed = new Set<string>([
        ...REPAIR_VIOLATION_CLASSES,
        "client-deterministic",
        "server-staged",
        "deterministic-fixed",
        "llm-fixed",
        "mixed-fixed",
        "unfixable",
        "abandoned",
        "deterministic",
        "llm-ops",
        "none",
        "fail",
        "warn",
        "applied",
        "no-error-reduction",
        "structure-shrunk-or-context-drift",
      ]);
      const uuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      let inspected = 0;
      for (const table of ["repair_runs", "repair_attempts"]) {
        const rows = await db.all<Record<string, unknown>>(
          `SELECT * FROM ${table}`,
        );
        assert.ok(rows.length > 0, `${table} produced no rows to inspect`);
        for (const row of rows) {
          for (const [column, value] of Object.entries(row)) {
            if (typeof value !== "string") continue;
            if (column === "owner_id") continue;
            if (column === "created_at") {
              assert.match(value, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
              continue;
            }
            inspected += 1;
            assert.ok(
              allowed.has(value) || uuid.test(value),
              `${table}.${column} holds unbounded text: ${value}`,
            );
          }
        }
      }
      assert.ok(inspected > 0, "no string cells were inspected at all");
    } finally {
      await backend.close();
    }
  });

  it("RP1 createdAt is a number on the run returned by record, on listRuns and on listAttempts, equal to now; durationMs numbers", async () => {
    const { backend, store } = await openStore(kind);
    try {
      const now = Date.UTC(2026, 7, 20, 12, 0, 0);
      const recorded = must(await store.record(run({ now })));
      assert.equal(typeof recorded.createdAt, "number");
      assert.equal(recorded.createdAt, now);
      assert.equal(typeof recorded.durationMs, "number");

      const runs = must(await store.listRuns());
      assert.equal(typeof runs[0]?.createdAt, "number");
      assert.equal(runs[0]?.createdAt, now);

      const attempts = must(await store.listAttempts(RUN_ID));
      assert.equal(typeof attempts[0]?.createdAt, "number");
      assert.equal(attempts[0]?.createdAt, now);
      assert.equal(typeof attempts[0]?.durationMs, "number");
    } finally {
      await backend.close();
    }
  });

  it("RP2 flags round-trip per attempt", async () => {
    const { backend, store } = await openStore(kind);
    try {
      await store.record(
        run({
          attempts: [
            attempt({
              round: 1,
              seq: 0,
              eligible: true,
              applied: false,
              changedYaml: true,
            }),
            attempt({
              round: 1,
              seq: 1,
              eligible: false,
              applied: true,
              changedYaml: false,
            }),
            attempt({
              round: 1,
              seq: 2,
              eligible: true,
              applied: true,
              changedYaml: true,
            }),
          ],
        }),
      );
      const attempts = must(await store.listAttempts(RUN_ID));
      assert.equal(attempts.length, 3);
      assert.equal(attempts[0]?.eligible, true);
      assert.equal(attempts[0]?.applied, false);
      assert.equal(attempts[0]?.changedYaml, true);
      assert.equal(attempts[1]?.eligible, false);
      assert.equal(attempts[1]?.applied, true);
      assert.equal(attempts[1]?.changedYaml, false);
      assert.equal(attempts[2]?.eligible, true);
      assert.equal(attempts[2]?.applied, true);
      assert.equal(attempts[2]?.changedYaml, true);
    } finally {
      await backend.close();
    }
  });

  it("RP3 re-recording a run id updates in place and replaces its attempts", async () => {
    const { backend, db, store } = await openStore(kind, "owner-a");
    try {
      await store.record(
        run({
          runId: RUN_ID,
          attempts: [
            attempt({
              round: 1,
              seq: 0,
              violationClass: "client-scope-missing",
            }),
            attempt({
              round: 1,
              seq: 1,
              violationClass: "client-scope-missing",
            }),
          ],
        }),
      );
      const before = await db.get<{ rowid: number }>(
        "SELECT rowid FROM repair_runs WHERE owner_id = ? AND run_id = ?",
        ["owner-a", RUN_ID],
      );
      await store.record(
        run({
          runId: RUN_ID,
          outcome: "llm-fixed",
          attempts: [
            attempt({
              round: 1,
              seq: 0,
              violationClass: "client-zero-adapters",
            }),
          ],
        }),
      );
      const after = await db.get<{ rowid: number }>(
        "SELECT rowid FROM repair_runs WHERE owner_id = ? AND run_id = ?",
        ["owner-a", RUN_ID],
      );
      assert.equal(after?.rowid, before?.rowid);
      const count = await db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM repair_runs WHERE owner_id = ? AND run_id = ?",
        ["owner-a", RUN_ID],
      );
      assert.equal(count?.n, 1);
      const attempts = await store.listAttempts(RUN_ID);
      assert.equal(attempts.success && attempts.value.length, 1);
      assert.equal(
        attempts.success && attempts.value[0]?.violationClass,
        "client-zero-adapters",
      );
    } finally {
      await backend.close();
    }
  });

  it("RP4 class stats count eligible and applied separately", async () => {
    const { backend, store } = await openStore(kind);
    try {
      await store.record(
        run({
          attempts: [
            attempt({
              round: 1,
              seq: 0,
              violationClass: "client-zero-adapters",
              durationMs: 10,
              eligible: true,
              applied: false,
            }),
            attempt({
              round: 1,
              seq: 1,
              violationClass: "client-zero-adapters",
              durationMs: 20,
              eligible: true,
              applied: false,
            }),
            attempt({
              round: 1,
              seq: 2,
              violationClass: "client-zero-adapters",
              durationMs: 30,
              eligible: true,
              applied: true,
            }),
            attempt({
              round: 1,
              seq: 3,
              violationClass: "client-zero-adapters",
              durationMs: 40,
              eligible: false,
              applied: false,
            }),
            attempt({
              round: 1,
              seq: 4,
              violationClass: "R03",
              durationMs: 42,
              eligible: false,
              applied: false,
              path: "llm-ops",
            }),
          ],
        }),
      );
      const stats = await store.classStats();
      assert.ok(stats.success);
      const byClass = new Map(
        (stats.success ? stats.value : []).map((s) => [s.violationClass, s]),
      );
      const zero = byClass.get("client-zero-adapters");
      assert.equal(zero?.attempts, 4);
      assert.equal(zero?.eligible, 3);
      assert.equal(zero?.applied, 1);
      assert.equal(typeof zero?.eligible, "number");
      assert.equal(typeof zero?.applied, "number");
      assert.equal(typeof zero?.medianDurationMs, "number");
      assert.equal(zero?.medianDurationMs, 20);
      const r03 = byClass.get("R03");
      assert.equal(r03?.attempts, 1);
      assert.equal(r03?.eligible, 0);
      assert.equal(typeof r03?.eligible, "number");
    } finally {
      await backend.close();
    }
  });

  it("RP5 class stats are scoped to the owner and filter by surface", async () => {
    const backend = await openBackend(kind);
    try {
      const a = createRepairTelemetryStore(backend.db, "owner-a");
      const b = createRepairTelemetryStore(backend.db, "owner-b");

      await a.record(
        run({
          runId: RUN_ID,
          surface: "client-deterministic",
          attempts: [attempt({ violationClass: "client-zero-adapters" })],
        }),
      );
      await b.record(
        run({
          runId: OTHER_RUN_ID,
          surface: "client-deterministic",
          attempts: [attempt({ violationClass: "client-zero-adapters" })],
        }),
      );

      const stats = must(await a.classStats());
      assert.ok(stats.length > 0, "class stats returned rows");
      const zero = stats.find(
        (s) => s.violationClass === "client-zero-adapters",
      );
      assert.equal(zero?.attempts, 1);
      assert.equal(zero?.eligible, 1);

      const serverStats = must(
        await a.classStats({ surface: "server-staged" }),
      );
      assert.equal(serverStats.length, 0);

      await a.record(
        run({
          runId: OTHER_RUN_ID,
          surface: "server-staged",
          outcome: "llm-fixed",
          attempts: [
            attempt({
              round: 1,
              seq: 0,
              violationClass: "client-zero-adapters",
              path: "llm-ops",
            }),
          ],
        }),
      );

      const cdRuns = must(
        await a.listRuns({ surface: "client-deterministic" }),
      );
      assert.equal(cdRuns.length, 1);
      assert.equal(cdRuns[0]?.surface, "client-deterministic");
      const ssRuns = must(await a.listRuns({ surface: "server-staged" }));
      assert.equal(ssRuns.length, 1);
      assert.equal(ssRuns[0]?.surface, "server-staged");

      const both = must(await a.classStats());
      const zeroBoth = both.find(
        (s) => s.violationClass === "client-zero-adapters",
      );
      assert.equal(zeroBoth?.attempts, 2);

      const serverOnly = must(await a.classStats({ surface: "server-staged" }));
      const zeroServer = serverOnly.find(
        (s) => s.violationClass === "client-zero-adapters",
      );
      assert.equal(zeroServer?.attempts, 1);
    } finally {
      await backend.close();
    }
  });

  it("RP6 retention evicts the oldest runs with their attempts, only this owner's, ties by insertion", async () => {
    const backend = await openBackend(kind);
    const db = backend.db;
    try {
      const a = createRepairTelemetryStore(backend.db, "owner-a");
      const b = createRepairTelemetryStore(backend.db, "owner-b");

      for (let i = 0; i < 3; i++) {
        const id = `44444444-4444-4444-8444-${String(i).padStart(12, "0")}`;
        await b.record(run({ runId: id, now: 2_000_000_000_000 + i }));
      }

      const total = MAX_REPAIR_RUNS_PER_OWNER + 3;
      for (let i = 0; i < total; i++) {
        const id = `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`;
        await a.record(run({ runId: id, now: 1_700_000_000_000 }));
      }

      const aRuns = await a.listRuns({ limit: MAX_REPAIR_RUNS_PER_OWNER });
      assert.equal(
        aRuns.success && aRuns.value.length,
        MAX_REPAIR_RUNS_PER_OWNER,
      );
      const gone = await db.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM repair_runs WHERE run_id IN (?, ?, ?)",
        [
          "33333333-3333-4333-8333-000000000000",
          "33333333-3333-4333-8333-000000000001",
          "33333333-3333-4333-8333-000000000002",
        ],
      );
      assert.equal(gone?.n, 0);
      const orphans = await db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM repair_attempts a
          WHERE NOT EXISTS (
            SELECT 1 FROM repair_runs r
             WHERE r.owner_id = a.owner_id AND r.run_id = a.run_id)`,
      );
      assert.equal(orphans?.n, 0);
      const bRuns = await b.listRuns({ limit: MAX_REPAIR_RUNS_PER_OWNER });
      assert.equal(bRuns.success && bRuns.value.length, 3);
    } finally {
      await backend.close();
    }
  }, 120_000); // five hundred transactions on a slow disk.

  it("RP7 listRuns and listAttempts hide other schema versions and other owners", async () => {
    const { backend, db, store } = await openStore(kind, "owner-a");
    try {
      const bStore = createRepairTelemetryStore(backend.db, "owner-b");
      await store.record(run({ runId: RUN_ID }));
      const attempts = await store.listAttempts(RUN_ID);
      assert.equal(attempts.success && attempts.value.length, 1);

      await bStore.record(run({ runId: OTHER_RUN_ID }));
      await db.run(
        "UPDATE repair_runs SET schema_version = 99 WHERE run_id = ?",
        [OTHER_RUN_ID],
      );

      const aRuns = await store.listRuns();
      assert.equal(aRuns.success && aRuns.value.length, 1);
      assert.equal(aRuns.success && aRuns.value[0]?.runId, RUN_ID);

      const aAttempts = await store.listAttempts(RUN_ID);
      assert.equal(aAttempts.success && aAttempts.value.length, 1);
    } finally {
      await backend.close();
    }
  });
});

describe("repair telemetry migration", () => {
  it("is additive on an existing database and idempotent on re-open", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hexagen-repair-db-"));
    const path = join(dir, "platform.db");

    // A database that predates this packet, carrying a row that must survive.
    const first = openPlatformDb(path);
    first
      .prepare(
        `INSERT INTO saved_projects
           (id, owner_id, name, payload, created_at, updated_at, ord)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("proj-1", "owner-a", "shop", '{"id":"proj-1"}', 1, 1, 0);
    first.exec("DROP TABLE repair_runs; DROP TABLE repair_attempts;");
    first.close();

    // Upgrade: the tables appear, the pre-existing row is untouched.
    const upgraded = openPlatformDb(path);
    const kept = upgraded
      .prepare("SELECT name FROM saved_projects WHERE id = ?")
      .get("proj-1") as { name: string } | undefined;
    assert.equal(kept?.name, "shop");
    const store = createRepairTelemetryStore(
      createSqlitePlatformDb(upgraded),
      "owner-a",
    );
    assert.equal((await store.record(run())).success, true);
    upgraded.close();

    // Re-open twice more: every statement is IF NOT EXISTS, so the telemetry
    // row written above must still be there.
    openPlatformDb(path).close();
    const third = openPlatformDb(path);
    const again = await createRepairTelemetryStore(
      createSqlitePlatformDb(third),
      "owner-a",
    ).listRuns();
    assert.ok(again.success);
    assert.equal(again.success && again.value.length, 1);
    third.close();
  });

  it("adds the tables without rewriting a legacy pre-owner database", () => {
    const dir = mkdtempSync(join(tmpdir(), "hexagen-repair-legacy-"));
    const path = join(dir, "platform.db");
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE saved_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        ord INTEGER NOT NULL
      );
    `);
    legacy
      .prepare(
        `INSERT INTO saved_projects (id, name, payload, created_at, updated_at, ord)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("proj-1", "shop", "{}", 1, 1, 0);
    legacy.close();

    const db = openPlatformDb(path);
    const kept = db
      .prepare("SELECT owner_id, name FROM saved_projects WHERE id = ?")
      .get("proj-1") as { owner_id: string; name: string };
    assert.equal(kept.name, "shop");
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'repair_%'",
      )
      .all() as Array<{ name: string }>;
    assert.deepEqual(tables.map((t) => t.name).sort(), [
      "repair_attempts",
      "repair_runs",
    ]);
    db.close();
  });
});
