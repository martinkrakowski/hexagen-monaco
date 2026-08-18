import { openPlatformDb, resolvePlatformDbPath } from "./platform-db";
import { createAuthRepository, type AuthRepository } from "./auth-store";
import {
  createSavedProjectsStore,
  type SavedProjectsStore,
} from "./saved-projects-store";
import {
  createRunHistoryRepository,
  type RunHistoryRepository,
} from "./run-history-store";
import {
  createEntitlementRepository,
  type EntitlementRepository,
} from "./billing";
import { createOwnerStateStore } from "./owner-state";

export interface PlatformStore {
  readonly auth: AuthRepository;
  readonly billing: EntitlementRepository;
  projectsFor(ownerId: string): SavedProjectsStore;
  runsFor(ownerId: string): RunHistoryRepository;
  isProjectsInitialized(ownerId: string): boolean;
  markProjectsInitialized(ownerId: string): void;
  close(): void;
}

export function createPlatformStore(dbPath: string): PlatformStore {
  const db = openPlatformDb(dbPath);
  const ownerState = createOwnerStateStore(db);
  return {
    auth: createAuthRepository(db),
    billing: createEntitlementRepository(db),
    projectsFor(ownerId) {
      return createSavedProjectsStore(db, ownerId);
    },
    runsFor(ownerId) {
      return createRunHistoryRepository(db, ownerId);
    },
    isProjectsInitialized(ownerId) {
      return ownerState.isInitialized(ownerId);
    },
    markProjectsInitialized(ownerId) {
      ownerState.markInitialized(ownerId);
    },
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
