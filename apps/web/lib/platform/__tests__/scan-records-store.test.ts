import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Database from "better-sqlite3";
import { openPlatformDb } from "../platform-db";
import {
  MAX_INLINE_FINDING_ENTRIES,
  MAX_SCAN_RECORDS_PER_OWNER,
  SCAN_RECORD_SCHEMA_VERSION,
  createScanRecordsStore,
  isPathInside,
  scanArtifactPath,
  type RecordScanInput,
} from "../scan-records-store";
import {
  MAX_SCAN_ERROR_CHARS,
  MAX_SCAN_LAYOUT_EXCERPT_CHARS,
  MAX_SCAN_REPORT_CHARS,
} from "@/lib/project-scan/limits";

/**
 * Path math only — the store never touches the filesystem, so this directory
 * is deliberately NOT created. If a test ever needs it to exist, that is a
 * signal the store grew an fs dependency it should not have.
 */
const ARTIFACTS_ROOT = join(tmpdir(), "hexagen-scan-artifacts-test");

const NOW = 1_700_000_000_000;

function harness(ownerId = "owner-a") {
  const db = openPlatformDb(":memory:");
  return {
    db,
    store: createScanRecordsStore(db, ownerId, ARTIFACTS_ROOT),
    other: createScanRecordsStore(db, "owner-b", ARTIFACTS_ROOT),
  };
}

const base: RecordScanInput = {
  projectName: "shop",
  repoRef: "acme/shop#main",
  tier: "B",
  verdict: "violations",
  exitCode: 1,
  filesScanned: 412,
  findings: { fresh: 3, baselined: 12, stale: 1, expired: 0 },
  findingsSample: [{ rule: "no-cross-context", file: "a.ts", specifier: "b" }],
  findingsTotal: 16,
  now: NOW,
};

/** Insert straight into the table, bypassing every guard the store applies. */
function rawInsert(
  db: Database.Database,
  overrides: Record<string, unknown>,
): void {
  const row = {
    id: "raw-1",
    owner_id: "owner-a",
    schema_version: SCAN_RECORD_SCHEMA_VERSION,
    project_name: "shop",
    repo_ref: null,
    tier: "B",
    verdict: "violations",
    exit_code: 1,
    files_scanned: 1,
    findings_fresh: 0,
    findings_baselined: 0,
    findings_stale: 0,
    findings_expired: 0,
    layout_excerpt: null,
    report_markdown: null,
    error_message: null,
    findings_sample: JSON.stringify({ entries: [], total: 0 }),
    artifact_path: null,
    artifact_bytes: null,
    created_at: 1,
    ...overrides,
  };
  db.prepare(
    `INSERT INTO scan_records (
       id, owner_id, schema_version, project_name, repo_ref, tier, verdict,
       exit_code, files_scanned, findings_fresh, findings_baselined,
       findings_stale, findings_expired, layout_excerpt, report_markdown,
       error_message, findings_sample, artifact_path, artifact_bytes, created_at
     ) VALUES (
       @id, @owner_id, @schema_version, @project_name, @repo_ref, @tier,
       @verdict, @exit_code, @files_scanned, @findings_fresh,
       @findings_baselined, @findings_stale, @findings_expired,
       @layout_excerpt, @report_markdown, @error_message, @findings_sample,
       @artifact_path, @artifact_bytes, @created_at
     )`,
  ).run(row);
}

describe("scan records store", () => {
  it("round-trips a record and keeps owners isolated", () => {
    const { store, other } = harness();
    const written = store.record(base);
    expect(written.success).toBe(true);
    if (!written.success) return;

    const listed = store.list();
    expect(listed.success).toBe(true);
    if (!listed.success) return;
    expect(listed.value.length).toBe(1);
    const record = listed.value[0];
    expect(record?.projectName).toBe("shop");
    expect(record?.repoRef).toBe("acme/shop#main");
    expect(record?.tier).toBe("B");
    expect(record?.verdict).toBe("violations");
    expect(record?.findings.baselined).toBe(12);
    expect(record?.findingsTotal).toBe(16);
    expect(record?.findingsSample.length).toBe(1);
    expect(record?.artifact).toBe(null);

    const foreign = other.list();
    expect(foreign.success).toBe(true);
    if (foreign.success) expect(foreign.value.length).toBe(0);
  });

  it("returns NotFound rather than throwing for a missing id", () => {
    const { store } = harness();
    const found = store.get("nope");
    expect(found.success).toBe(false);
    if (!found.success) expect(found.error.kind).toBe("NotFound");
  });

  it("filters by repoRef", () => {
    const { store } = harness();
    store.record(base);
    store.record({ ...base, repoRef: "acme/other", now: NOW + 1 });
    const filtered = store.list({ repoRef: "acme/other" });
    expect(filtered.success).toBe(true);
    if (filtered.success) {
      expect(filtered.value.length).toBe(1);
      expect(filtered.value[0]?.repoRef).toBe("acme/other");
    }
  });
});

describe("scan records store — bulk containment", () => {
  it("clips oversized text to the shared scan limits", () => {
    const { store } = harness();
    const written = store.record({
      ...base,
      reportMarkdown: "r".repeat(MAX_SCAN_REPORT_CHARS + 500),
      layoutExcerpt: "l".repeat(MAX_SCAN_LAYOUT_EXCERPT_CHARS + 500),
      errorMessage: "e".repeat(MAX_SCAN_ERROR_CHARS + 500),
    });
    expect(written.success).toBe(true);
    if (!written.success) return;
    expect(written.value.record.reportMarkdown?.length).toBe(
      MAX_SCAN_REPORT_CHARS,
    );
    expect(written.value.record.layoutExcerpt?.length).toBe(
      MAX_SCAN_LAYOUT_EXCERPT_CHARS,
    );
    expect(written.value.record.errorMessage?.length).toBe(
      MAX_SCAN_ERROR_CHARS,
    );
  });

  it("caps the inline findings sample but preserves the real total", () => {
    const { store } = harness();
    const sample = Array.from({ length: 400 }, (_, i) => ({
      rule: "x".repeat(1000),
      file: `f${i}.ts`,
      specifier: "s",
    }));
    const written = store.record({
      ...base,
      findingsSample: sample,
      findingsTotal: 400,
    });
    expect(written.success).toBe(true);
    if (!written.success) return;
    const record = written.value.record;
    expect(record.findingsSample.length).toBe(MAX_INLINE_FINDING_ENTRIES);
    expect(record.findingsTotal).toBe(400);
    expect(record.findingsSample[0]?.rule.length).toBe(300);
  });

  it("never lets the stated total undercount the stored sample", () => {
    const { store } = harness();
    const written = store.record({
      ...base,
      findingsSample: [
        { rule: "a", file: "a.ts", specifier: "s" },
        { rule: "b", file: "b.ts", specifier: "s" },
      ],
      findingsTotal: 0,
    });
    expect(written.success).toBe(true);
    if (written.success) expect(written.value.record.findingsTotal).toBe(2);
  });
});

describe("scan records store — artifact paths", () => {
  it("stores a path derived by scanArtifactPath with its size", () => {
    const { store } = harness();
    const path = scanArtifactPath(ARTIFACTS_ROOT, "owner-a", "scan-1");
    const written = store.record({
      ...base,
      artifact: { path, bytes: 2048 },
    });
    expect(written.success).toBe(true);
    if (!written.success) return;
    expect(written.value.record.artifact?.path).toBe(path);
    expect(written.value.record.artifact?.bytes).toBe(2048);
  });

  it("rejects an artifact path outside the artifacts root", () => {
    const { store } = harness();
    const escape = join(ARTIFACTS_ROOT, "..", "..", "etc", "passwd");
    const written = store.record({
      ...base,
      artifact: { path: escape, bytes: 10 },
    });
    expect(written.success).toBe(false);
    if (!written.success) {
      expect(written.error.message).toMatch(/outside this owner's artifacts directory/);
    }
    const listed = store.list();
    if (listed.success) expect(listed.value.length).toBe(0);
  });

  it("rejects an out-of-range artifact size", () => {
    const { store } = harness();
    const path = scanArtifactPath(ARTIFACTS_ROOT, "owner-a", "scan-2");
    for (const bytes of [-1, Number.NaN, 1024 ** 4]) {
      const written = store.record({ ...base, artifact: { path, bytes } });
      expect(written.success).toBe(false);
      if (!written.success) {
        expect(written.error.message).toMatch(/size is out of range/);
      }
    }
  });

  it("scanArtifactPath REJECTS hostile segments rather than sanitising them", () => {
    // Sanitising was the original approach and it caused a collision: any two
    // ids differing only in stripped characters mapped to one file. Rejecting
    // keeps the mapping injective, so a stored path names exactly one scan.
    expect(() =>
      scanArtifactPath(ARTIFACTS_ROOT, "../../root", "id"),
    ).toThrow();
    expect(() =>
      scanArtifactPath(ARTIFACTS_ROOT, "owner", "../../../etc/passwd"),
    ).toThrow();
    for (const hostile of [".", "..", "a..b", "../x", "x/y"]) {
      expect(
        () => scanArtifactPath(ARTIFACTS_ROOT, "owner", hostile),
        `hostile segment ${hostile} must be rejected`,
      ).toThrow();
    }
  });

  it("refuses another owner's artifact path", () => {
    // The containment check used to compare against the SHARED root, so owner
    // A could record a path naming owner B's artifact. record() hands
    // evictedArtifactPaths back for the caller to unlink, so retention would
    // then delete another tenant's file: cross-tenant deletion is the
    // mechanism, not a downstream consequence.
    const { db, store } = harness("attacker");
    const victimPath = scanArtifactPath(ARTIFACTS_ROOT, "victim", "s1");

    const outcome = store.record({
      ...base,
      artifact: { path: victimPath, bytes: 10 },
    });

    expect(outcome.success).toBe(false);
    if (!outcome.success) {
      expect(outcome.error.message).toMatch(/outside this owner/i);
    }
    // Sanity: the same path IS inside the shared root, which is exactly why
    // the old check passed it.
    expect(isPathInside(ARTIFACTS_ROOT, victimPath)).toBe(true);
    db.close();
  });

  it("distinct scan ids never collapse to one artifact path", () => {
    // `scan.1` and `scan1` both became `scan1.zip` when '.' was stripped, so
    // two scans silently shared one artifact file -- and retention unlinking
    // one would take the other's bytes with it.
    const a = scanArtifactPath(ARTIFACTS_ROOT, "owner", "scan.1");
    const b = scanArtifactPath(ARTIFACTS_ROOT, "owner", "scan1");
    expect(a).not.toBe(b);
    expect(isPathInside(ARTIFACTS_ROOT, a)).toBe(true);
    expect(isPathInside(ARTIFACTS_ROOT, b)).toBe(true);
  });

  it("accepts a dot inside an id, matching SCAN_ID_PATTERN", () => {
    // The route's allow-list is /^[A-Za-z0-9._-]{1,64}$/, so a legitimate id
    // carrying a dot must still resolve rather than be refused.
    const p = scanArtifactPath(ARTIFACTS_ROOT, "owner", "scan.1");
    expect(p.endsWith("scan.1.zip")).toBe(true);
  });

  it("isPathInside rejects the root itself and any parent", () => {
    expect(isPathInside(ARTIFACTS_ROOT, ARTIFACTS_ROOT)).toBe(false);
    expect(isPathInside(ARTIFACTS_ROOT, join(ARTIFACTS_ROOT, ".."))).toBe(
      false,
    );
    expect(isPathInside(ARTIFACTS_ROOT, join(ARTIFACTS_ROOT, "a", "b"))).toBe(
      true,
    );
  });
});

describe("scan records store — untrusted enum + name input", () => {
  it("rejects an unknown tier or verdict instead of coercing it", () => {
    const { store } = harness();
    const badTier = store.record({
      ...base,
      tier: "Z" as unknown as "A",
    });
    expect(badTier.success).toBe(false);
    const badVerdict = store.record({
      ...base,
      verdict: "green" as unknown as "pass",
    });
    expect(badVerdict.success).toBe(false);
  });

  it("rejects an empty or oversized project name", () => {
    const { store } = harness();
    expect(store.record({ ...base, projectName: "   " }).success).toBe(false);
    expect(
      store.record({ ...base, projectName: "n".repeat(500) }).success,
    ).toBe(false);
  });
});

describe("scan records store — versioning is discard, not migrate", () => {
  it("hides a row written under a different schema_version", () => {
    const { db, store } = harness();
    rawInsert(db, { id: "future", schema_version: 99 });
    rawInsert(db, { id: "current" });

    const listed = store.list();
    expect(listed.success).toBe(true);
    if (listed.success) {
      expect(listed.value.map((r) => r.id)).toEqual(["current"]);
    }
    const found = store.get("future");
    expect(found.success).toBe(false);
    if (!found.success) expect(found.error.kind).toBe("NotFound");
  });

  it("does not delete a foreign-version row on read (rollback safety)", () => {
    const { db, store } = harness();
    rawInsert(db, { id: "future", schema_version: 99 });
    store.list();
    store.get("future");
    const remaining = db
      .prepare("SELECT COUNT(*) AS n FROM scan_records")
      .get() as { n: number };
    expect(remaining.n).toBe(1);
  });

  it("drops a row whose findings blob no longer parses, rather than reading it as empty", () => {
    const { db, store } = harness();
    rawInsert(db, { id: "corrupt", findings_sample: "{not json" });
    rawInsert(db, { id: "shaped-wrong", findings_sample: '{"entries":42}' });
    rawInsert(db, { id: "ok" });

    const listed = store.list();
    expect(listed.success).toBe(true);
    if (listed.success) expect(listed.value.map((r) => r.id)).toEqual(["ok"]);
  });

  it("reports an unreadable row by id as DeserializationFailed, not NotFound", () => {
    const { db, store } = harness();
    rawInsert(db, { id: "corrupt", findings_sample: "{not json" });
    const found = store.get("corrupt");
    expect(found.success).toBe(false);
    if (!found.success) expect(found.error.kind).toBe("DeserializationFailed");
  });

  it("drops a row whose stored enum is no longer recognised", () => {
    const { db, store } = harness();
    rawInsert(db, { id: "alien", verdict: "maybe" });
    const listed = store.list();
    if (listed.success) expect(listed.value.length).toBe(0);
  });
});

describe("scan records store — retention", () => {
  it("evicts the oldest rows past the per-owner cap and names their artifacts", () => {
    const { store } = harness();
    const total = MAX_SCAN_RECORDS_PER_OWNER + 2;
    const evicted: string[] = [];
    for (let i = 0; i < total; i += 1) {
      const id = `scan-${String(i).padStart(4, "0")}`;
      const written = store.record({
        ...base,
        id,
        artifact: {
          path: scanArtifactPath(ARTIFACTS_ROOT, "owner-a", id),
          bytes: 1,
        },
        now: NOW + i,
      });
      expect(written.success).toBe(true);
      if (written.success) evicted.push(...written.value.evictedArtifactPaths);
    }

    const listed = store.list({ limit: MAX_SCAN_RECORDS_PER_OWNER });
    expect(listed.success).toBe(true);
    if (listed.success) {
      expect(listed.value.length).toBe(MAX_SCAN_RECORDS_PER_OWNER);
    }
    expect(evicted.length).toBe(2);
    expect(evicted[0]).toBe(
      scanArtifactPath(ARTIFACTS_ROOT, "owner-a", "scan-0000"),
    );
    expect(store.get("scan-0000").success).toBe(false);
  });

  it("reclaims foreign-version rows too, so a version bump cannot leak storage", () => {
    const { db, store } = harness();
    for (let i = 0; i < MAX_SCAN_RECORDS_PER_OWNER; i += 1) {
      rawInsert(db, {
        id: `old-${String(i).padStart(4, "0")}`,
        schema_version: 99,
        created_at: i,
      });
    }
    const written = store.record({ ...base, id: "new", now: 9_000_000 });
    expect(written.success).toBe(true);
    const remaining = db
      .prepare("SELECT COUNT(*) AS n FROM scan_records")
      .get() as { n: number };
    expect(remaining.n).toBe(MAX_SCAN_RECORDS_PER_OWNER);
  });
});

describe("scan records store — trend", () => {
  it("returns the newest window oldest-first", () => {
    const { store } = harness();
    for (let i = 0; i < 5; i += 1) {
      store.record({
        ...base,
        id: `t-${i}`,
        findings: { fresh: i, baselined: 0, stale: 0, expired: 0 },
        now: NOW + i,
      });
    }
    const trend = store.trend({ limit: 3 });
    expect(trend.success).toBe(true);
    if (!trend.success) return;
    expect(trend.value.map((p) => p.id)).toEqual(["t-2", "t-3", "t-4"]);
    expect(trend.value.map((p) => p.fresh)).toEqual([2, 3, 4]);
  });

  it("survives a corrupt findings blob because it never reads one", () => {
    const { db, store } = harness();
    rawInsert(db, { id: "corrupt", findings_sample: "{not json", created_at: 1 });
    const trend = store.trend();
    expect(trend.success).toBe(true);
    if (trend.success) expect(trend.value.map((p) => p.id)).toEqual(["corrupt"]);
  });
});
