import type { SavedProjectsPersistencePort } from "@hexagen/shared";
import { openPlatformDb, resolvePlatformDbPath } from "./platform-db";
import { createAuthRepository, type AuthRepository } from "./auth-store";
import { createSavedProjectsStore } from "./saved-projects-store";
import {
  createRunHistoryRepository,
  type RunHistoryRepository,
} from "./run-history-store";
import {
  createEntitlementRepository,
  type EntitlementRepository,
} from "./billing";

export interface PlatformStore {
  readonly auth: AuthRepository;
  readonly projects: SavedProjectsPersistencePort;
  readonly runs: RunHistoryRepository;
  readonly billing: EntitlementRepository;
  close(): void;
}

export function createPlatformStore(dbPath: string): PlatformStore {
  const db = openPlatformDb(dbPath);
  return {
    auth: createAuthRepository(db),
    projects: createSavedProjectsStore(db),
    runs: createRunHistoryRepository(db),
    billing: createEntitlementRepository(db),
    close() {
      db.close();
    },
  };
}

let singleton: PlatformStore | null = null;

export function getPlatformStore(): PlatformStore {
  if (!singleton) {
    singleton = createPlatformStore(resolvePlatformDbPath());
  }
  return singleton;
}

export function closePlatformStore(): void {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}
