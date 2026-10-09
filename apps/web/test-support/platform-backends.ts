import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PlatformDb, PlatformDbSession } from "../lib/platform/db";
import { createSqlitePlatformDb } from "../lib/platform/sqlite-db";
import { openPlatformDb } from "../lib/platform/platform-db";
import { createPlatformStoreOn } from "../lib/platform/store";
import type { PlatformStore } from "../lib/platform/store";
import { createTestPgDb } from "./pg-test-db";

export type BackendKind = "sqlite" | "postgres";
export const BACKENDS: readonly BackendKind[] = ["sqlite", "postgres"];

export interface Backend {
  readonly kind: BackendKind;
  readonly db: PlatformDb;
  readonly store: PlatformStore;
  close(): Promise<void>;
}

export async function openBackend(
  kind: BackendKind,
  opts?: { artifactsDir?: string; pgMax?: number },
): Promise<Backend> {
  if (kind === "sqlite") {
    const db = createSqlitePlatformDb(openPlatformDb(":memory:"));
    const artifactsDir =
      opts?.artifactsDir ?? mkdtempSync(join(tmpdir(), "hx-artifacts-"));
    return {
      kind,
      db,
      store: createPlatformStoreOn(db, artifactsDir),
      close: async () => {
        await db.close();
        rmSync(artifactsDir, { recursive: true, force: true });
      },
    };
  }

  const { db, drop } = await createTestPgDb({ max: opts?.pgMax });
  const artifactsDir =
    opts?.artifactsDir ?? mkdtempSync(join(tmpdir(), "hx-artifacts-"));
  let dropped = false;
  return {
    kind,
    db,
    store: createPlatformStoreOn(db, artifactsDir),
    close: async () => {
      if (dropped) return;
      dropped = true;
      await db.close();
      await drop();
      rmSync(artifactsDir, { recursive: true, force: true });
    },
  };
}

export function failOnSql(
  db: PlatformDb,
  match: (sql: string) => boolean,
  error: Error,
): PlatformDb {
  const wrap = (session: PlatformDbSession): PlatformDbSession => ({
    get: async (sql, params) =>
      match(sql) ? Promise.reject(error) : session.get(sql, params),
    all: async (sql, params) =>
      match(sql) ? Promise.reject(error) : session.all(sql, params),
    run: async (sql, params) =>
      match(sql) ? Promise.reject(error) : session.run(sql, params),
  });

  const outer = wrap(db);
  return {
    dialect: db.dialect,
    isUniqueViolation: (e: unknown) => db.isUniqueViolation(e),
    isForeignKeyViolation: (e: unknown) => db.isForeignKeyViolation(e),
    get: outer.get,
    all: outer.all,
    run: outer.run,
    transaction: async <T>(
      fn: (tx: PlatformDbSession) => Promise<T>,
    ): Promise<T> => db.transaction((tx) => fn(wrap(tx))),
    close: () => db.close(),
  };
}
