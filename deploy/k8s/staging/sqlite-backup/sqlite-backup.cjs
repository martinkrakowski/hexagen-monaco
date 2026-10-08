// Online backup of the web app's SQLite files, run by CronJob
// hexagen-sqlite-backup with the app's own image (which has no sqlite3 binary;
// better-sqlite3's backup API is the consistent way to copy a live WAL
// database). Plain CommonJS with no dependency of its own: the driver is
// resolved from the app's install.
//
//   node sqlite-backup.cjs          back up every database that exists
//   node sqlite-backup.cjs counts   print row counts, live and newest backup
//
// Environment (all optional): BACKUP_SRC_DIR (/data), BACKUP_DEST_DIR
// (/backups), BACKUP_KEEP (7), BACKUP_REQUIRE_FROM (/app/apps/web/).
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const SRC = process.env.BACKUP_SRC_DIR || "/data";
const DEST = process.env.BACKUP_DEST_DIR || "/backups";
const KEEP = Number(process.env.BACKUP_KEEP || "7");
const REQUIRE_FROM = process.env.BACKUP_REQUIRE_FROM || "/app/apps/web/";
const DATABASES = ["platform", "byok", "quota"];

const Database = createRequire(REQUIRE_FROM)("better-sqlite3");

function log(line) {
  process.stdout.write(`${line}\n`);
}

function backupsOf(name) {
  const pattern = new RegExp(`^${name}-\\d{8}T\\d{6}Z\\.db$`);
  // The stamp sorts as text, so the newest is last.
  return fs
    .readdirSync(DEST)
    .filter((file) => pattern.test(file))
    .sort();
}

function tableCounts(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    return tables.map((table) => [
      table,
      db.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n,
    ]);
  } finally {
    db.close();
  }
}

async function backupOne(name, stamp) {
  const source = path.join(SRC, `${name}.db`);
  if (!fs.existsSync(source)) {
    log(`${name}: absent in ${SRC}, skipped`);
    return "absent";
  }
  const final = path.join(DEST, `${name}-${stamp}.db`);
  // A scheduled run and a hand-started one can overlap, so each run writes to
  // its own temporary name.
  const part = `${final}.${process.pid}-${Date.now().toString(36)}.part`;
  try {
    return await copyAndCheck(name, source, part, final);
  } catch (error) {
    // This run's own partial copy, and anything SQLite put beside it.
    for (const suffix of ["", "-wal", "-shm", "-journal"])
      fs.rmSync(`${part}${suffix}`, { force: true });
    throw error;
  }
}

async function copyAndCheck(name, source, part, final) {
  const live = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await live.backup(part);
  } finally {
    live.close();
  }
  // The copy is still in WAL mode, which would leave -wal and -shm files
  // beside it on the first read. Make it one self-contained file, then check it.
  const copy = new Database(part);
  let tables;
  try {
    const mode = copy.pragma("journal_mode = DELETE", { simple: true });
    if (mode !== "delete")
      throw new Error(`the copy stayed in ${mode} journal mode`);
    const verdict = copy.pragma("integrity_check", { simple: true });
    if (verdict !== "ok")
      throw new Error(`integrity_check on the copy said: ${verdict}`);
    tables = copy
      .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'")
      .get().n;
    // Every store creates its tables when it opens the file, so a database
    // with none is not a state the app can leave: it is an empty or stray file.
    if (tables === 0) throw new Error("the copy has no tables");
  } finally {
    copy.close();
  }
  // A hard link fails if the name is taken, where a rename would silently
  // replace it: two runs in the same second must not overwrite each other.
  try {
    fs.linkSync(part, final);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    fs.rmSync(part, { force: true });
    log(
      `${name}: ${path.basename(final)} already written by another run this second, kept`,
    );
    return "done";
  }
  fs.rmSync(part, { force: true });
  log(
    `${name}: ${path.basename(final)} ${fs.statSync(final).size} bytes, ${tables} tables, integrity ok`,
  );
  return "done";
}

function prune(name, justWritten) {
  // Never the copy this run just made, whatever the other names say: with a
  // clock that was once wrong, an older file can carry a later stamp.
  const candidates = backupsOf(name).filter((file) => file !== justWritten);
  const old = candidates.slice(0, Math.max(0, candidates.length - (KEEP - 1)));
  // force: another run may be pruning the same file.
  for (const file of old) fs.rmSync(path.join(DEST, file), { force: true });
  if (old.length > 0) log(`${name}: pruned ${old.length}, kept ${KEEP}`);
}

// A temporary copy older than this was left behind by a run that was killed:
// the job's own deadline is ten minutes.
const LEFTOVER_AFTER_MS = 20 * 60 * 1000;

function removeLeftovers() {
  for (const file of fs.readdirSync(DEST)) {
    if (!/\.part(-wal|-shm|-journal)?$/.test(file)) continue;
    const full = path.join(DEST, file);
    // Another run may rename or remove its own file between the listing and here.
    const stat = fs.statSync(full, { throwIfNoEntry: false });
    if (stat && Date.now() - stat.mtimeMs > LEFTOVER_AFTER_MS)
      fs.rmSync(full, { force: true });
  }
}

async function runBackup() {
  if (!Number.isInteger(KEEP) || KEEP < 1)
    throw new Error(
      `BACKUP_KEEP must be a whole number of 1 or more: ${process.env.BACKUP_KEEP}`,
    );
  removeLeftovers();
  // BACKUP_TEST_STAMP lets a test put two runs in the same second.
  const stamp =
    process.env.BACKUP_TEST_STAMP ||
    new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d+Z$/, "Z");
  let done = 0;
  let failed = 0;
  for (const name of DATABASES) {
    try {
      if ((await backupOne(name, stamp)) === "done") {
        done += 1;
        prune(name, `${name}-${stamp}.db`);
      }
    } catch (error) {
      failed += 1;
      log(`${name}: FAILED: ${error.message}`);
      // The stack says which step failed: open, copy, check, name or prune.
      process.stderr.write(`${error.stack}\n`);
    }
  }
  // A run that copied nothing is a failure, not a quiet success: the volume
  // is missing or mounted in the wrong place.
  if (done === 0) throw new Error(`no database was backed up from ${SRC}`);
  if (failed > 0) throw new Error(`${failed} database(s) failed`);
}

function runCounts() {
  for (const name of DATABASES) {
    const source = path.join(SRC, `${name}.db`);
    const newest = backupsOf(name).pop();
    if (!fs.existsSync(source) && !newest) {
      log(`${name}: no live file and no backup`);
      continue;
    }
    const live = fs.existsSync(source)
      ? new Map(tableCounts(source))
      : new Map();
    const kept = newest
      ? new Map(tableCounts(path.join(DEST, newest)))
      : new Map();
    log(
      `${name}: live ${fs.existsSync(source) ? source : "(absent)"}, backup ${newest || "(none)"}`,
    );
    for (const table of [...new Set([...live.keys(), ...kept.keys()])].sort()) {
      log(
        `  ${table}: live=${live.has(table) ? live.get(table) : "-"} backup=${kept.has(table) ? kept.get(table) : "-"}`,
      );
    }
  }
}

const mode = process.argv[2] || "backup";
const run =
  mode === "counts"
    ? async () => runCounts()
    : mode === "backup"
      ? runBackup
      : null;
if (!run) {
  process.stderr.write(`usage: node sqlite-backup.cjs [backup|counts]\n`);
  process.exit(64);
}
run().catch((error) => {
  process.stderr.write(`sqlite-backup: ${error.message}\n${error.stack}\n`);
  process.exit(1);
});
