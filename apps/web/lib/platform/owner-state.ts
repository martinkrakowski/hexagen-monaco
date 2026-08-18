import type Database from "better-sqlite3";

export interface OwnerStateStore {
  isInitialized(ownerId: string): boolean;
  markInitialized(ownerId: string): void;
}

export function createOwnerStateStore(db: Database.Database): OwnerStateStore {
  const select = db.prepare(
    "SELECT initialized FROM project_owner_state WHERE owner_id = ?",
  );
  const upsert = db.prepare(`
    INSERT INTO project_owner_state (owner_id, initialized)
    VALUES (?, 1)
    ON CONFLICT(owner_id) DO UPDATE SET initialized = 1
  `);
  return {
    isInitialized(ownerId) {
      const row = select.get(ownerId) as { initialized: number } | undefined;
      return row?.initialized === 1;
    },
    markInitialized(ownerId) {
      upsert.run(ownerId);
    },
  };
}
