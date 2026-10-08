// @vitest-environment node
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The script the staging CronJob runs. It lives beside its manifest, outside
// any package, so it is exercised here as the job runs it: as a child process.
const SCRIPT = resolve(
  __dirname,
  "../../../../deploy/k8s/staging/sqlite-backup/sqlite-backup.cjs",
);
const WEB_ROOT = resolve(__dirname, "../..") + "/";

let root: string;
let src: string;
let dest: string;

function run(mode: string[] = [], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...mode], {
    encoding: "utf8",
    env: {
      ...process.env,
      BACKUP_SRC_DIR: src,
      BACKUP_DEST_DIR: dest,
      BACKUP_REQUIRE_FROM: WEB_ROOT,
      ...env,
    },
  });
}

function seed(name: string, rows: number): void {
  const db = new Database(join(src, `${name}.db`));
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE things (id INTEGER PRIMARY KEY, label TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO things (label) VALUES (?)");
  for (let i = 0; i < rows; i += 1) insert.run(`row ${i}`);
  db.close();
}

function backups(name: string): string[] {
  return readdirSync(dest)
    .filter((file) => file.startsWith(`${name}-`))
    .sort();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "hexagen-sqlite-backup-"));
  src = join(root, "data");
  dest = join(root, "backups");
  mkdirSync(src);
  mkdirSync(dest);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("sqlite-backup.cjs", () => {
  it("copies every database that exists, and the copy holds the rows", () => {
    seed("platform", 5);
    seed("byok", 2);

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(backups("platform")).toHaveLength(1);
    expect(backups("byok")).toHaveLength(1);
    const copy = new Database(join(dest, backups("platform")[0]), {
      readonly: true,
    });
    expect(copy.prepare("SELECT count(*) AS n FROM things").get()).toEqual({
      n: 5,
    });
    copy.close();
  });

  it("reports a database that is absent and still succeeds on the others", () => {
    seed("platform", 1);

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("quota: absent");
    expect(backups("quota")).toHaveLength(0);
  });

  it("leaves one self-contained file per backup: no -wal, -shm or .part beside it", () => {
    seed("platform", 3);

    expect(run().status).toBe(0);
    // Reading the copy must not create sidecar files either.
    const copy = new Database(join(dest, backups("platform")[0]), {
      readonly: true,
    });
    expect(copy.pragma("journal_mode", { simple: true })).toBe("delete");
    copy.prepare("SELECT count(*) FROM things").get();
    copy.close();

    expect(readdirSync(dest)).toEqual([
      expect.stringMatching(/^platform-\d{8}T\d{6}Z\.db$/),
    ]);
  });

  it("sees rows written after the last checkpoint (they are still in the WAL)", () => {
    seed("platform", 1);
    const live = new Database(join(src, "platform.db"));
    live.pragma("wal_autocheckpoint = 0");
    live.prepare("INSERT INTO things (label) VALUES ('only in the wal')").run();

    const result = run();
    live.close();

    expect(result.status, result.stderr).toBe(0);
    const copy = new Database(join(dest, backups("platform")[0]), {
      readonly: true,
    });
    expect(copy.prepare("SELECT count(*) AS n FROM things").get()).toEqual({
      n: 2,
    });
    copy.close();
  });

  it("fails when it backs up nothing, instead of reporting a quiet success", () => {
    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no database was backed up");
  });

  it("fails on a file that is not a database, keeps no trace of it, and still backs up the rest", () => {
    seed("platform", 1);
    writeFileSync(
      join(src, "quota.db"),
      "this is not a database, only text long enough to be read",
    );

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("quota: FAILED");
    expect(backups("platform")).toHaveLength(1);
    expect(readdirSync(dest).filter((file) => file.includes("quota"))).toEqual(
      [],
    );
  });

  it("removes a partial copy that a killed run left behind long ago", () => {
    seed("platform", 1);
    const stale = join(dest, "platform-20260101T000000Z.db.1-abc.part");
    writeFileSync(stale, "half a copy");
    const anHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(stale, anHourAgo, anHourAgo);

    expect(run().status).toBe(0);

    expect(readdirSync(dest).filter((file) => file.includes(".part"))).toEqual(
      [],
    );
  });

  it("leaves a fresh partial copy alone: it may belong to a run that is still going", () => {
    seed("platform", 1);
    const active = "platform-20260101T000000Z.db.2-def.part";
    writeFileSync(join(dest, active), "another run, mid-copy");

    expect(run().status).toBe(0);

    expect(readdirSync(dest)).toContain(active);
  });

  it("keeps only the newest BACKUP_KEEP copies of each database", () => {
    seed("platform", 1);
    for (const stamp of [
      "20260101T000000Z",
      "20260102T000000Z",
      "20260103T000000Z",
    ]) {
      writeFileSync(join(dest, `platform-${stamp}.db`), "an older backup");
    }

    expect(run([], { BACKUP_KEEP: "2" }).status).toBe(0);

    const kept = backups("platform");
    expect(kept).toHaveLength(2);
    expect(kept[0]).toBe("platform-20260103T000000Z.db");
  });

  it("refuses a keep count that would delete every backup", () => {
    seed("platform", 1);

    const result = run([], { BACKUP_KEEP: "0" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("BACKUP_KEEP");
    expect(backups("platform")).toHaveLength(0);
  });

  it("counts: reads the backup, not the live file twice", () => {
    seed("platform", 4);
    expect(run().status).toBe(0);
    const live = new Database(join(src, "platform.db"));
    live
      .prepare("INSERT INTO things (label) VALUES ('written after the backup')")
      .run();
    live.close();

    const result = run(["counts"]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("things: live=5 backup=4");
  });

  it("fails on a database with no tables: no store leaves one, so it is an empty or stray file", () => {
    seed("platform", 1);
    new Database(join(src, "byok.db")).close();

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("byok: FAILED: the copy has no tables");
    expect(readdirSync(dest).filter((file) => file.includes("byok"))).toEqual(
      [],
    );
  });

  it("never prunes the copy it just made, even when older files carry later stamps", () => {
    seed("platform", 1);
    for (const stamp of ["20990101T000000Z", "20990102T000000Z"]) {
      writeFileSync(
        join(dest, `platform-${stamp}.db`),
        "a backup from a clock that was wrong",
      );
    }

    expect(run([], { BACKUP_KEEP: "1" }).status).toBe(0);

    const kept = backups("platform");
    expect(kept).toHaveLength(1);
    expect(kept[0]).not.toContain("2099");
    const copy = new Database(join(dest, kept[0]), { readonly: true });
    expect(copy.prepare("SELECT count(*) AS n FROM things").get()).toEqual({
      n: 1,
    });
    copy.close();
  });
});
