// @vitest-environment node
import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  BACKENDS,
  openBackend,
  type BackendKind,
} from "../../../test-support/platform-backends";
import type { PlatformDb } from "../db";
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

async function harness(kind: BackendKind, ownerId = "owner-a") {
  const backend = await openBackend(kind, { artifactsDir: ARTIFACTS_ROOT });
  return {
    backend,
    db: backend.db,
    store: createScanRecordsStore(backend.db, ownerId, ARTIFACTS_ROOT),
    other: createScanRecordsStore(backend.db, "owner-b", ARTIFACTS_ROOT),
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
async function rawInsert(db: PlatformDb, overrides: Record<string, unknown>) {
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
  await db.run(
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
       @artifact_path, @artifact_bytes, hx_ts(@created_at)
     )`,
    row,
  );
}

/** The value of a successful result; fails the test, with the error, when it is not one. */
function must<T>(
  r: { success: true; value: T } | { success: false; error: unknown },
): T {
  if (!r.success)
    throw new Error(`expected success, got ${JSON.stringify(r.error)}`);
  return r.value;
}

describe("scan records store — pure path math", () => {
  it("scanArtifactPath REJECTS hostile segments rather than sanitising them", () => {
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

  it("distinct scan ids never collapse to one artifact path", () => {
    const a = scanArtifactPath(ARTIFACTS_ROOT, "owner", "scan.1");
    const b = scanArtifactPath(ARTIFACTS_ROOT, "owner", "scan1");
    expect(a).not.toBe(b);
    expect(isPathInside(ARTIFACTS_ROOT, a)).toBe(true);
    expect(isPathInside(ARTIFACTS_ROOT, b)).toBe(true);
  });

  it("accepts a dot inside an id, matching SCAN_ID_PATTERN", () => {
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

describe.each(BACKENDS)("scan records store (%s)", (kind) => {
  it("round-trips a record and keeps owners isolated", async () => {
    const { backend, store, other } = await harness(kind);
    try {
      const written = await store.record(base);
      expect(written.success).toBe(true);

      const listed = must(await store.list());
      expect(listed.length).toBe(1);
      const record = listed[0];
      expect(record?.projectName).toBe("shop");
      expect(record?.repoRef).toBe("acme/shop#main");
      expect(record?.tier).toBe("B");
      expect(record?.verdict).toBe("violations");
      expect(record?.findings.baselined).toBe(12);
      expect(record?.findingsTotal).toBe(16);
      expect(record?.findingsSample.length).toBe(1);
      expect(record?.artifact).toBe(null);

      const foreign = must(await other.list());
      expect(foreign.length).toBe(0);
    } finally {
      await backend.close();
    }
  });

  it("returns NotFound rather than throwing for a missing id", async () => {
    const { backend, store } = await harness(kind);
    try {
      const found = await store.get("nope");
      expect(found.success).toBe(false);
      if (!found.success) expect(found.error.kind).toBe("NotFound");
    } finally {
      await backend.close();
    }
  });

  it("filters by repoRef", async () => {
    const { backend, store } = await harness(kind);
    try {
      await store.record(base);
      await store.record({ ...base, repoRef: "acme/other", now: NOW + 1 });
      const filtered = must(await store.list({ repoRef: "acme/other" }));
      expect(filtered.length).toBe(1);
      expect(filtered[0]?.repoRef).toBe("acme/other");
    } finally {
      await backend.close();
    }
  });

  describe("scan records store — bulk containment", () => {
    it("clips oversized text to the shared scan limits", async () => {
      const { backend, store } = await harness(kind);
      try {
        const written = await store.record({
          ...base,
          reportMarkdown: "r".repeat(MAX_SCAN_REPORT_CHARS + 500),
          layoutExcerpt: "l".repeat(MAX_SCAN_LAYOUT_EXCERPT_CHARS + 500),
          errorMessage: "e".repeat(MAX_SCAN_ERROR_CHARS + 500),
        });
        expect(written.success).toBe(true);
        const rec = must(written).record;
        expect(rec.reportMarkdown?.length).toBe(MAX_SCAN_REPORT_CHARS);
        expect(rec.layoutExcerpt?.length).toBe(MAX_SCAN_LAYOUT_EXCERPT_CHARS);
        expect(rec.errorMessage?.length).toBe(MAX_SCAN_ERROR_CHARS);
      } finally {
        await backend.close();
      }
    });

    it("caps the inline findings sample but preserves the real total", async () => {
      const { backend, store } = await harness(kind);
      try {
        const sample = Array.from({ length: 400 }, (_, i) => ({
          rule: "x".repeat(1000),
          file: `f${i}.ts`,
          specifier: "s",
        }));
        const written = await store.record({
          ...base,
          findingsSample: sample,
          findingsTotal: 400,
        });
        expect(written.success).toBe(true);
        const record = must(written).record;
        expect(record.findingsSample.length).toBe(MAX_INLINE_FINDING_ENTRIES);
        expect(record.findingsTotal).toBe(400);
        expect(record.findingsSample[0]?.rule.length).toBe(300);
      } finally {
        await backend.close();
      }
    });

    it("never lets the stated total undercount the stored sample", async () => {
      const { backend, store } = await harness(kind);
      try {
        const written = await store.record({
          ...base,
          findingsSample: [
            { rule: "a", file: "a.ts", specifier: "s" },
            { rule: "b", file: "b.ts", specifier: "s" },
          ],
          findingsTotal: 0,
        });
        expect(written.success).toBe(true);
        expect(must(written).record.findingsTotal).toBe(2);
      } finally {
        await backend.close();
      }
    });
  });

  describe("scan records store — artifact paths", () => {
    it("stores a path derived by scanArtifactPath with its size", async () => {
      const { backend, store } = await harness(kind);
      try {
        const path = scanArtifactPath(ARTIFACTS_ROOT, "owner-a", "scan-1");
        const written = await store.record({
          ...base,
          artifact: { path, bytes: 2048 },
        });
        expect(written.success).toBe(true);
        const rec = must(written).record;
        expect(rec.artifact?.path).toBe(path);
        expect(rec.artifact?.bytes).toBe(2048);
      } finally {
        await backend.close();
      }
    });

    it("rejects an artifact path outside the artifacts root", async () => {
      const { backend, store } = await harness(kind);
      try {
        const escape = join(ARTIFACTS_ROOT, "..", "..", "etc", "passwd");
        const written = await store.record({
          ...base,
          artifact: { path: escape, bytes: 10 },
        });
        expect(written.success).toBe(false);
        if (written.success) return;
        expect(written.error.message).toMatch(
          /outside this owner's artifacts directory/,
        );
        const listed = must(await store.list());
        expect(listed.length).toBe(0);
      } finally {
        await backend.close();
      }
    });

    it("rejects an out-of-range artifact size", async () => {
      const { backend, store } = await harness(kind);
      try {
        const path = scanArtifactPath(ARTIFACTS_ROOT, "owner-a", "scan-2");
        for (const bytes of [-1, Number.NaN, 1024 ** 4]) {
          const written = await store.record({
            ...base,
            artifact: { path, bytes },
          });
          expect(written.success).toBe(false);
          if (written.success) return;
          expect(written.error.message).toMatch(/size is out of range/);
        }
      } finally {
        await backend.close();
      }
    });

    it("refuses another owner's artifact path", async () => {
      const { backend, store } = await harness(kind, "attacker");
      try {
        const victimPath = scanArtifactPath(ARTIFACTS_ROOT, "victim", "s1");
        const outcome = await store.record({
          ...base,
          artifact: { path: victimPath, bytes: 10 },
        });
        expect(outcome.success).toBe(false);
        if (outcome.success) return;
        expect(outcome.error.message).toMatch(/outside this owner/i);
        expect(isPathInside(ARTIFACTS_ROOT, victimPath)).toBe(true);
      } finally {
        await backend.close();
      }
    });
  });

  describe("scan records store — untrusted enum + name input", () => {
    it("rejects an unknown tier or verdict instead of coercing it", async () => {
      const { backend, store } = await harness(kind);
      try {
        const badTier = await store.record({
          ...base,
          tier: "Z" as unknown as "A",
        });
        expect(badTier.success).toBe(false);
        const badVerdict = await store.record({
          ...base,
          verdict: "green" as unknown as "pass",
        });
        expect(badVerdict.success).toBe(false);
      } finally {
        await backend.close();
      }
    });

    it("rejects an empty or oversized project name", async () => {
      const { backend, store } = await harness(kind);
      try {
        expect(
          (await store.record({ ...base, projectName: "   " })).success,
        ).toBe(false);
        expect(
          (await store.record({ ...base, projectName: "n".repeat(500) }))
            .success,
        ).toBe(false);
      } finally {
        await backend.close();
      }
    });
  });

  describe("scan records store — versioning is discard, not migrate", () => {
    it("hides a row written under a different schema_version", async () => {
      const { backend, db, store } = await harness(kind);
      try {
        await rawInsert(db, { id: "future", schema_version: 99 });
        await rawInsert(db, { id: "current" });
        const listed = must(await store.list());
        expect(listed.map((r) => r.id)).toEqual(["current"]);
        const found = await store.get("future");
        expect(found.success).toBe(false);
        if (!found.success) expect(found.error.kind).toBe("NotFound");
      } finally {
        await backend.close();
      }
    });

    it("does not delete a foreign-version row on read (rollback safety)", async () => {
      const { backend, db, store } = await harness(kind);
      try {
        await rawInsert(db, { id: "future", schema_version: 99 });
        await store.list();
        await store.get("future");
        const remaining = await db.get<{ n: number }>(
          "SELECT COUNT(*) AS n FROM scan_records",
        );
        expect(remaining?.n).toBe(1);
      } finally {
        await backend.close();
      }
    });

    it.runIf(kind === "postgres")(
      "jsonb refuses an invalid JSON findings blob at insert (error 22P02)",
      async () => {
        const { backend, db } = await harness(kind);
        try {
          await expect(
            rawInsert(db, {
              id: "bad-json",
              findings_sample: "{not json",
            }),
          ).rejects.toMatchObject({ code: "22P02" });
        } finally {
          await backend.close();
        }
      },
    );

    it("drops a row whose findings blob has the wrong shape, rather than reading it as empty", async () => {
      const { backend, db, store } = await harness(kind);
      try {
        await rawInsert(db, {
          id: "shaped-wrong",
          findings_sample: '{"entries":42}',
        });
        await rawInsert(db, { id: "ok" });
        const listed = must(await store.list());
        expect(listed.map((r) => r.id)).toEqual(["ok"]);
      } finally {
        await backend.close();
      }
    });

    it.runIf(kind === "sqlite")(
      "drops a row whose findings blob no longer parses, rather than reading it as empty (jsonb refuses invalid JSON)",
      async () => {
        const { backend, db, store } = await harness(kind);
        try {
          await rawInsert(db, { id: "corrupt", findings_sample: "{not json" });
          await rawInsert(db, {
            id: "shaped-wrong",
            findings_sample: '{"entries":42}',
          });
          await rawInsert(db, { id: "ok" });
          const listed = must(await store.list());
          expect(listed.map((r) => r.id)).toEqual(["ok"]);
        } finally {
          await backend.close();
        }
      },
    );

    it("reports an unreadable row by id as DeserializationFailed, not NotFound", async () => {
      const { backend, db, store } = await harness(kind);
      try {
        await rawInsert(db, {
          id: "shaped-wrong",
          findings_sample: '{"entries":42}',
        });
        const found = await store.get("shaped-wrong");
        expect(found.success).toBe(false);
        if (!found.success)
          expect(found.error.kind).toBe("DeserializationFailed");
      } finally {
        await backend.close();
      }
    });

    it.runIf(kind === "sqlite")(
      "reports an unreadable row with invalid JSON by id as DeserializationFailed (jsonb refuses invalid JSON)",
      async () => {
        const { backend, db, store } = await harness(kind);
        try {
          await rawInsert(db, { id: "corrupt", findings_sample: "{not json" });
          const found = await store.get("corrupt");
          expect(found.success).toBe(false);
          if (!found.success)
            expect(found.error.kind).toBe("DeserializationFailed");
        } finally {
          await backend.close();
        }
      },
    );

    it("drops a row whose stored enum is no longer recognised", async () => {
      const { backend, db, store } = await harness(kind);
      try {
        await rawInsert(db, { id: "alien", verdict: "maybe" });
        const listed = must(await store.list());
        expect(listed.length).toBe(0);
      } finally {
        await backend.close();
      }
    });
  });

  describe("scan records store — retention", () => {
    it("evicts the oldest rows past the per-owner cap and names their artifacts", async () => {
      const { backend, store } = await harness(kind);
      try {
        const total = MAX_SCAN_RECORDS_PER_OWNER + 2;
        const evicted: string[] = [];
        for (let i = 0; i < total; i += 1) {
          const id = `scan-${String(i).padStart(4, "0")}`;
          const written = await store.record({
            ...base,
            id,
            artifact: {
              path: scanArtifactPath(ARTIFACTS_ROOT, "owner-a", id),
              bytes: 1,
            },
            now: NOW + i,
          });
          expect(written.success).toBe(true);
          if (written.success)
            evicted.push(...written.value.evictedArtifactPaths);
        }

        const listed = must(
          await store.list({ limit: MAX_SCAN_RECORDS_PER_OWNER }),
        );
        expect(listed.length).toBe(MAX_SCAN_RECORDS_PER_OWNER);
        expect(evicted.length).toBe(2);
        expect(evicted[0]).toBe(
          scanArtifactPath(ARTIFACTS_ROOT, "owner-a", "scan-0000"),
        );
        expect((await store.get("scan-0000")).success).toBe(false);
      } finally {
        await backend.close();
      }
    }, 120_000); // five hundred transactions on a slow disk.

    it("reclaims foreign-version rows too, so a version bump cannot leak storage", async () => {
      const { backend, db, store } = await harness(kind);
      try {
        for (let i = 0; i < MAX_SCAN_RECORDS_PER_OWNER; i += 1) {
          await rawInsert(db, {
            id: `old-${String(i).padStart(4, "0")}`,
            schema_version: 99,
            created_at: i,
          });
        }
        const written = await store.record({
          ...base,
          id: "new",
          now: 9_000_000,
        });
        expect(written.success).toBe(true);
        const remaining = await db.get<{ n: number }>(
          "SELECT COUNT(*) AS n FROM scan_records",
        );
        expect(remaining?.n).toBe(MAX_SCAN_RECORDS_PER_OWNER);
      } finally {
        await backend.close();
      }
    });
  });

  describe("scan records store — trend", () => {
    it("returns the newest window oldest-first", async () => {
      const { backend, store } = await harness(kind);
      try {
        for (let i = 0; i < 5; i += 1) {
          await store.record({
            ...base,
            id: `t-${i}`,
            findings: { fresh: i, baselined: 0, stale: 0, expired: 0 },
            now: NOW + i,
          });
        }
        const trend = must(await store.trend({ limit: 3 }));
        expect(trend.map((p) => p.id)).toEqual(["t-2", "t-3", "t-4"]);
        expect(trend.map((p) => p.fresh)).toEqual([2, 3, 4]);
      } finally {
        await backend.close();
      }
    });

    it("survives a findings blob of the wrong shape because it never reads one", async () => {
      const { backend, db, store } = await harness(kind);
      try {
        await rawInsert(db, {
          id: "corrupt",
          findings_sample: '{"entries":42}',
          created_at: 1,
        });
        const trend = must(await store.trend());
        expect(trend.map((p) => p.id)).toEqual(["corrupt"]);
      } finally {
        await backend.close();
      }
    });

    it.runIf(kind === "sqlite")(
      "survives an invalid JSON findings blob because it never reads one (jsonb refuses invalid JSON)",
      async () => {
        const { backend, db, store } = await harness(kind);
        try {
          await rawInsert(db, {
            id: "corrupt",
            findings_sample: "{not json",
            created_at: 1,
          });
          const trend = must(await store.trend());
          expect(trend.map((p) => p.id)).toEqual(["corrupt"]);
        } finally {
          await backend.close();
        }
      },
    );
  });

  describe("scan records — both backends", () => {
    it("SC1 createdAt is a number on record, get, list and trend, and equals the time given", async () => {
      const { backend, store } = await harness(kind);
      try {
        const path = scanArtifactPath(ARTIFACTS_ROOT, "owner-a", "sc1");
        const recorded = await store.record({
          ...base,
          id: "sc1",
          findingsTotal: 5,
          artifact: { path, bytes: 2048 },
          now: NOW,
        });
        expect(recorded.success).toBe(true);
        const rec = must(recorded).record;
        expect(typeof rec.createdAt).toBe("number");
        expect(rec.createdAt).toBe(NOW);
        expect(typeof rec.findingsTotal).toBe("number");
        expect(typeof rec.artifact?.bytes).toBe("number");

        const got = must(await store.get("sc1"));
        expect(typeof got.createdAt).toBe("number");
        expect(got.createdAt).toBe(NOW);

        const listed = must(await store.list());
        expect(typeof listed[0]?.createdAt).toBe("number");
        expect(listed[0]?.createdAt).toBe(NOW);

        const trend = must(await store.trend());
        expect(typeof trend[0]?.createdAt).toBe("number");
        expect(trend[0]?.createdAt).toBe(NOW);
      } finally {
        await backend.close();
      }
    });

    it("SC2 equal timestamps are ordered by insertion", async () => {
      const { backend, store } = await harness(kind);
      try {
        for (const id of ["sc2-a", "sc2-b", "sc2-c"]) {
          const written = await store.record({ ...base, id, now: NOW });
          expect(written.success).toBe(true);
        }
        const listed = must(await store.list());
        expect(listed.map((r) => r.id)).toEqual(["sc2-c", "sc2-b", "sc2-a"]);

        const trend = must(await store.trend());
        expect(trend.map((r) => r.id)).toEqual(["sc2-a", "sc2-b", "sc2-c"]);
      } finally {
        await backend.close();
      }
    });

    it("SC3 list honours schema_version, repoRef, limit and owner", async () => {
      const { backend, db, store, other } = await harness(kind);
      try {
        await store.record({
          ...base,
          id: "r1",
          repoRef: "acme/a",
          now: NOW + 1,
        });
        await store.record({
          ...base,
          id: "r2",
          repoRef: "acme/b",
          now: NOW + 2,
        });
        await store.record({
          ...base,
          id: "r3",
          repoRef: "acme/a",
          now: NOW + 3,
        });
        await store.record({
          ...base,
          id: "r4",
          repoRef: "acme/b",
          now: NOW + 4,
        });
        await store.record({
          ...base,
          id: "r5",
          repoRef: "acme/a",
          now: NOW + 5,
        });
        await rawInsert(db, {
          id: "r6",
          repo_ref: "acme/a",
          schema_version: 99,
          created_at: NOW + 6,
        });

        const filtered = must(await store.list({ repoRef: "acme/a" }));
        expect(filtered.map((r) => r.id).sort()).toEqual(["r1", "r3", "r5"]);

        const limited = must(await store.list({ limit: 2 }));
        expect(limited.length).toBe(2);

        const otherList = await other.list();
        // population-guard: owner-b has no records of its own
        if (otherList.success)
          expect(otherList.value.map((r) => r.id)).not.toContain("r1");
      } finally {
        await backend.close();
      }
    });

    it("SC4 retention evicts the oldest, by time and then insertion order, and only this owner's", async () => {
      const { backend, store, other } = await harness(kind);
      try {
        for (let i = 0; i < 3; i++) {
          const written = await other.record({
            ...base,
            id: `b-${i}`,
            now: NOW + i,
          });
          expect(written.success).toBe(true);
        }

        const evicted: string[] = [];
        for (let i = 0; i < MAX_SCAN_RECORDS_PER_OWNER + 2; i += 1) {
          const id = `a-${String(i).padStart(4, "0")}`;
          const written = await store.record({
            ...base,
            id,
            now: NOW,
            artifact: {
              path: scanArtifactPath(ARTIFACTS_ROOT, "owner-a", id),
              bytes: 1,
            },
          });
          expect(written.success).toBe(true);
          if (written.success)
            evicted.push(...written.value.evictedArtifactPaths);
        }

        expect(evicted.length).toBe(2);
        expect(evicted[0]).toBe(
          scanArtifactPath(ARTIFACTS_ROOT, "owner-a", "a-0000"),
        );
        expect(evicted[1]).toBe(
          scanArtifactPath(ARTIFACTS_ROOT, "owner-a", "a-0001"),
        );

        const aList = must(
          await store.list({ limit: MAX_SCAN_RECORDS_PER_OWNER }),
        );
        expect(aList.length).toBe(MAX_SCAN_RECORDS_PER_OWNER);
        expect((await store.get("a-0000")).success).toBe(false);
        expect((await store.get("a-0001")).success).toBe(false);

        const bList = must(await other.list());
        expect(bList.length).toBe(3);
      } finally {
        await backend.close();
      }
    }, 120_000); // five hundred transactions on a slow disk.

    it("SC5 a repeated id is a Conflict for the same owner and is fine for another owner", async () => {
      const { backend, store, other } = await harness(kind);
      try {
        const first = await store.record({ ...base, id: "dup", now: NOW });
        expect(first.success).toBe(true);

        const second = await store.record({ ...base, id: "dup", now: NOW + 1 });
        expect(second.success).toBe(false);
        if (second.success) return;
        expect(second.error.kind).toBe("Conflict");

        const got = must(await store.get("dup"));
        expect(got.createdAt).toBe(NOW);

        const otherRecorded = await other.record({
          ...base,
          id: "dup",
          now: NOW + 2,
        });
        expect(otherRecorded.success).toBe(true);
      } finally {
        await backend.close();
      }
    });

    it("SC6 the findings sample round-trips entry for entry", async () => {
      const { backend, store } = await harness(kind);
      try {
        const sample = [
          { rule: "R01", file: "a.ts", specifier: "x" },
          { rule: "R02", file: "b.ts", specifier: "café" },
          { rule: "R03", file: "c.ts", specifier: "日本語" },
        ];
        const written = await store.record({
          ...base,
          id: "sc6",
          findingsSample: sample,
          findingsTotal: 100,
          now: NOW,
        });
        expect(written.success).toBe(true);
        const rec = must(written).record;

        const got = must(await store.get("sc6"));
        expect(got.findingsSample).toEqual(sample);
        expect(got.findingsTotal).toBe(100);
      } finally {
        await backend.close();
      }
    });

    it("SC7 trend returns the newest window oldest-first, repoRef-filtered", async () => {
      const { backend, store } = await harness(kind);
      try {
        for (let i = 0; i < 7; i++) {
          const ref = i % 2 === 0 ? "acme/a" : "acme/b";
          const written = await store.record({
            ...base,
            id: `sc7-${i}`,
            repoRef: ref,
            now: NOW + i,
            findings: { fresh: i, baselined: 0, stale: 0, expired: 0 },
          });
          expect(written.success).toBe(true);
        }
        const trend = must(await store.trend({ limit: 3, repoRef: "acme/a" }));
        expect(trend.map((p) => p.id)).toEqual(["sc7-2", "sc7-4", "sc7-6"]);
      } finally {
        await backend.close();
      }
    });
  });
});
