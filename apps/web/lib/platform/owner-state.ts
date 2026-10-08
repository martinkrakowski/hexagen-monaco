import type { PlatformDb } from "./db";

export interface OwnerStateStore {
  isInitialized(ownerId: string): Promise<boolean>;
  markInitialized(ownerId: string): Promise<void>;
}

export function createOwnerStateStore(db: PlatformDb): OwnerStateStore {
  return {
    async isInitialized(ownerId) {
      const row = await db.get<{ initialized: number } | undefined>(
        "SELECT initialized FROM project_owner_state WHERE owner_id = ?",
        [ownerId],
      );
      return row?.initialized === 1;
    },
    async markInitialized(ownerId) {
      await db.run(
        `
  INSERT INTO project_owner_state (owner_id, initialized)
  VALUES (?, 1)
  ON CONFLICT(owner_id) DO UPDATE SET initialized = 1
`,
        [ownerId],
      );
    },
  };
}
