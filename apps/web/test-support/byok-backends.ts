/**
 * Two-backend test helper for the BYOK store. Each backend gets its own
 * PlatformDb and a ByokStore built on it via createByokStoreOn.
 *
 * - "sqlite" opens the BYOK schema directly (openByokDb), NOT the platform one.
 * - "postgres" gets a migrated clone (full PG_MIGRATIONS chain) with its own pool.
 */
import type { PlatformDb } from "../lib/platform/db";
import type { ByokStore } from "../lib/byok-store";
import { createByokStoreOn, openByokDb } from "../lib/byok-store";
import { createSqlitePlatformDb } from "../lib/platform/sqlite-db";
import { createTestPgDb } from "./pg-test-db";
import { BACKENDS } from "./platform-backends";

export type { BackendKind } from "./platform-backends";

export interface ByokBackend {
  readonly kind: "sqlite" | "postgres";
  readonly db: PlatformDb;
  readonly store: ByokStore;
  close(): Promise<void>;
}

export async function openByokBackend(
  kind: "sqlite" | "postgres",
  opts?: { pgMax?: number },
): Promise<ByokBackend> {
  if (kind === "sqlite") {
    const db = createSqlitePlatformDb(openByokDb(":memory:"));
    const store = createByokStoreOn(db);
    return {
      kind,
      db,
      store,
      close: async () => {
        await store.close();
      },
    };
  }

  const { db, drop } = await createTestPgDb({ max: opts?.pgMax ?? 2 });
  const store = createByokStoreOn(db);
  return {
    kind,
    db,
    store,
    close: async () => {
      await store.close();
      await drop();
    },
  };
}

export { BACKENDS };
