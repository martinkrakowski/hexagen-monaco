import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { canAutoFix, type ViolationCode } from "@hexagen/manifest-generation";
import { openPlatformDb } from "../platform-db";
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
function openStore(ownerId = "owner-a") {
  const db = openPlatformDb(":memory:");
  return { db, store: createRepairTelemetryStore(db, ownerId) };
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

describe("repair telemetry store", () => {
  it("persists a run and its attempts together", () => {
    const { db, store } = openStore();
    const written = store.record(run());
    assert.equal(written.success, true);
    assert.ok(written.success && written.value.attemptsTotal === 1);
    assert.ok(written.success && written.value.attemptsApplied === 1);

    const runs = store.listRuns();
    assert.ok(runs.success);
    assert.equal(runs.success && runs.value.length, 1);
    assert.equal(runs.success && runs.value[0]?.outcome, "deterministic-fixed");

    const attempts = store.listAttempts(RUN_ID);
    assert.ok(attempts.success);
    assert.equal(attempts.success && attempts.value.length, 1);
    assert.equal(
      attempts.success && attempts.value[0]?.violationClass,
      "client-scope-missing",
    );
    db.close();
  });

  it("scopes rows to the owner", () => {
    const db = openPlatformDb(":memory:");
    const a = createRepairTelemetryStore(db, "owner-a");
    const b = createRepairTelemetryStore(db, "owner-b");
    // Asserted, not discarded: `record` returns a Result rather than throwing,
    // so a fixture that stopped validating would make "b sees 0 rows" pass for
    // the wrong reason -- b sees nothing because nothing exists.
    assert.equal(a.record(run()).success, true);
    const seen = b.listRuns();
    assert.ok(seen.success);
    assert.equal(seen.success && seen.value.length, 0);
    db.close();
  });

  it("records eligible-but-unapplied as its own state", () => {
    // The whole reason the two flags are separate columns: this is the class a
    // tuned fixer must not inherit, and today it is silent.
    const { db, store } = openStore();
    store.record(
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
    const attempts = store.listAttempts(RUN_ID);
    assert.ok(attempts.success);
    const row = attempts.success ? attempts.value[0] : undefined;
    assert.equal(row?.eligible, true);
    assert.equal(row?.applied, false);
    assert.equal(row?.changedYaml, false);
    db.close();
  });

  it("keeps unfixable and abandoned distinguishable", () => {
    const { db, store } = openStore();
    store.record(run({ runId: RUN_ID, outcome: "unfixable" }));
    store.record(run({ runId: OTHER_RUN_ID, outcome: "abandoned" }));
    const runs = store.listRuns();
    assert.ok(runs.success);
    const outcomes = runs.success
      ? runs.value.map((r) => r.outcome).sort()
      : [];
    assert.deepEqual(outcomes, ["abandoned", "unfixable"]);
    db.close();
  });

  it("upserts on (owner, run_id) so a reconnect does not double-count", () => {
    const { db, store } = openStore();
    const first = store.record(run({ rounds: 1 }));
    const second = store.record(run({ rounds: 4, durationMs: 900 }));
    const runs = store.listRuns();
    assert.ok(runs.success);
    assert.equal(runs.success && runs.value.length, 1);
    assert.equal(runs.success && runs.value[0]?.rounds, 4);
    assert.equal(runs.success && runs.value[0]?.durationMs, 900);
    // The returned record must be the STORED row: the conflicting row keeps
    // its original primary key, so a caller that trusted the freshly minted
    // id would be holding a key that is not in the table.
    assert.equal(
      first.success && second.success && second.value.id,
      first.success ? first.value.id : undefined,
    );
    assert.equal(
      runs.success && runs.value[0]?.id,
      first.success ? first.value.id : undefined,
    );
    db.close();
  });

  it("replaces the attempt set wholesale on re-record", () => {
    const { db, store } = openStore();
    store.record(
      run({
        attempts: [
          attempt({ round: 1, seq: 0 }),
          attempt({ round: 2, seq: 0 }),
          attempt({ round: 3, seq: 0 }),
        ],
      }),
    );
    store.record(run({ attempts: [attempt({ round: 1, seq: 0 })] }));
    const attempts = store.listAttempts(RUN_ID);
    assert.ok(attempts.success);
    // Orphans from the longer previous loop would make attempts_total lie.
    assert.equal(attempts.success && attempts.value.length, 1);
    const runs = store.listRuns();
    assert.equal(runs.success && runs.value[0]?.attemptsTotal, 1);
    db.close();
  });

  it("rejects a non-opaque run id instead of storing it", () => {
    const { db, store } = openStore();
    const bad = store.record(run({ runId: "acme/billing-service" }));
    assert.equal(bad.success, false);
    // The rejection message must not echo the value it refused.
    assert.ok(!bad.success && !bad.error.message.includes("acme"));
    assert.equal(store.listRuns().success && store.listRuns().value?.length, 0);
    db.close();
  });

  it("rejects unknown enum values rather than coercing them", () => {
    const { db, store } = openStore();
    const loose = store.record as unknown as (i: Record<string, unknown>) => {
      success: boolean;
    };
    assert.equal(loose({ ...run(), surface: "smuggled-text" }).success, false);
    assert.equal(loose({ ...run(), outcome: "probably-fine" }).success, false);
    assert.equal(
      loose({
        ...run(),
        attempts: [{ ...attempt(), violationClass: 'Context Name "Billing"' }],
      }).success,
      false,
    );
    assert.equal(
      loose({
        ...run(),
        attempts: [{ ...attempt(), path: "magic" }],
      }).success,
      false,
    );
    assert.equal(
      loose({
        ...run(),
        attempts: [{ ...attempt(), gateReason: "because" }],
      }).success,
      false,
    );
    db.close();
  });

  it("rejects a duplicate round/seq pair rather than losing an attempt", () => {
    const { db, store } = openStore();
    const dup = store.record({
      ...run(),
      attempts: [attempt({ round: 1, seq: 0 }), attempt({ round: 1, seq: 0 })],
    });
    assert.equal(dup.success, false);
    db.close();
  });

  it("aggregates per violation class with a median duration", () => {
    const { db, store } = openStore();
    store.record(
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
    const stats = store.classStats();
    assert.ok(stats.success);
    const byClass = new Map(
      (stats.success ? stats.value : []).map((s) => [s.violationClass, s]),
    );
    const zero = byClass.get("client-zero-adapters");
    assert.equal(zero?.attempts, 3);
    assert.equal(zero?.eligible, 3);
    assert.equal(zero?.applied, 1);
    // Median, not mean: the 30s outlier must not become the class's number.
    assert.equal(zero?.medianDurationMs, 5);
    const r03 = byClass.get("R03");
    assert.equal(r03?.attempts, 1);
    assert.equal(r03?.eligible, 0);
    db.close();
  });

  it("filters class stats by surface", () => {
    const { db, store } = openStore();
    store.record(run({ runId: RUN_ID, surface: "client-deterministic" }));
    store.record(
      run({
        runId: OTHER_RUN_ID,
        surface: "server-staged",
        outcome: "llm-fixed",
        attempts: [
          attempt({ violationClass: "R05", path: "llm-ops", eligible: false }),
        ],
      }),
    );
    const server = store.classStats({ surface: "server-staged" });
    assert.ok(server.success);
    assert.deepEqual(
      server.success ? server.value.map((s) => s.violationClass) : [],
      ["R05"],
    );
    db.close();
  });

  it("evicts the oldest runs and their attempts past the per-owner cap", () => {
    const { db, store } = openStore();
    const total = MAX_REPAIR_RUNS_PER_OWNER + 3;
    for (let i = 0; i < total; i++) {
      const id = `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`;
      store.record(run({ runId: id, now: 1_700_000_000_000 + i }));
    }
    const runs = store.listRuns({ limit: MAX_REPAIR_RUNS_PER_OWNER });
    assert.ok(runs.success);
    assert.equal(runs.success && runs.value.length, MAX_REPAIR_RUNS_PER_OWNER);
    // Attempts must go with their run: a surviving orphan is a row the
    // class-stats join drops, i.e. a table that reads smaller than it is.
    const orphans = db
      .prepare(
        `SELECT COUNT(*) AS n FROM repair_attempts a
          WHERE NOT EXISTS (
            SELECT 1 FROM repair_runs r
             WHERE r.owner_id = a.owner_id AND r.run_id = a.run_id)`,
      )
      .get() as { n: number };
    assert.equal(orphans.n, 0);
    db.close();
  });

  it("hides rows written under a foreign schema_version instead of decoding them", () => {
    const { db, store } = openStore();
    assert.equal(store.record(run()).success, true);
    db.prepare("UPDATE repair_runs SET schema_version = 99").run();
    const runs = store.listRuns();
    assert.ok(runs.success);
    assert.equal(runs.success && runs.value.length, 0);
    db.close();
  });

  it("drops a row whose stored enum no longer parses", () => {
    const { db, store } = openStore();
    assert.equal(store.record(run()).success, true);
    db.prepare("UPDATE repair_runs SET outcome = 'from-the-future'").run();
    const runs = store.listRuns();
    assert.ok(runs.success);
    // Coercing to a default would be a silently skewed baseline.
    assert.equal(runs.success && runs.value.length, 0);
    db.close();
  });

  it("stores nothing outside the closed value sets", () => {
    // Belt to the guards: read every column back raw and assert that no cell
    // holds a string that isn't an enum member or the opaque run id. This is
    // the test that would fail if someone later added a `title` column.
    const { db, store } = openStore();
    assert.equal(store.record(run()).success, true);
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
    // Counted so the guard cannot pass by inspecting nothing. This is the
    // assertion that no user architecture reaches a column, and a vacuous
    // version of it is worse than none -- it reports the guarantee holds while
    // having looked at zero cells.
    let inspected = 0;
    for (const table of ["repair_runs", "repair_attempts"]) {
      const rows = db.prepare(`SELECT * FROM ${table}`).all() as Array<
        Record<string, unknown>
      >;
      assert.ok(rows.length > 0, `${table} produced no rows to inspect`);
      for (const row of rows) {
        for (const [column, value] of Object.entries(row)) {
          if (typeof value !== "string") continue;
          if (column === "owner_id") continue;
          inspected += 1;
          assert.ok(
            allowed.has(value) || uuid.test(value),
            `${table}.${column} holds unbounded text: ${value}`,
          );
        }
      }
    }
    assert.ok(inspected > 0, "no string cells were inspected at all");
    db.close();
  });
});

describe("repair telemetry migration", () => {
  it("is additive on an existing database and idempotent on re-open", () => {
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
    const store = createRepairTelemetryStore(upgraded, "owner-a");
    assert.equal(store.record(run()).success, true);
    upgraded.close();

    // Re-open twice more: every statement is IF NOT EXISTS, so the telemetry
    // row written above must still be there.
    openPlatformDb(path).close();
    const third = openPlatformDb(path);
    const again = createRepairTelemetryStore(third, "owner-a").listRuns();
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
