import {
  openPlatformDb,
  resolvePlatformDbPath,
  resolveScanArtifactsDir,
} from "./platform-db";
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
import {
  createScanRecordsStore,
  type ScanRecordsStore,
} from "./scan-records-store";

export interface PlatformStore {
  readonly auth: AuthRepository;
  readonly billing: EntitlementRepository;
  projectsFor(ownerId: string): SavedProjectsStore;
  runsFor(ownerId: string): RunHistoryRepository;
  scansFor(ownerId: string): ScanRecordsStore;
  /**
   * Where this store expects scan artifact bytes to live. Exposed so a route
   * can write the file and mkdir the directory -- the row store itself does no
   * filesystem I/O.
   */
  readonly scanArtifactsDir: string;
  isProjectsInitialized(ownerId: string): boolean;
  markProjectsInitialized(ownerId: string): void;
  close(): void;
}

export function createPlatformStore(
  dbPath: string,
  // Overridable so a suite can point artifacts at a temp dir without touching
  // process.env. Unlike the db path there is no `:memory:` equivalent for a
  // directory, so the default is a real path even under NODE_ENV=test.
  artifactsDir: string = resolveScanArtifactsDir(),
): PlatformStore {
  const db = openPlatformDb(dbPath);
  const ownerState = createOwnerStateStore(db);
  return {
    scanArtifactsDir: artifactsDir,
    auth: createAuthRepository(db),
    billing: createEntitlementRepository(db),
    projectsFor(ownerId) {
      return createSavedProjectsStore(db, ownerId);
    },
    runsFor(ownerId) {
      return createRunHistoryRepository(db, ownerId);
    },
    scansFor(ownerId) {
      return createScanRecordsStore(db, ownerId, artifactsDir);
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
