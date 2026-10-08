import {
  openPlatformDb,
  resolvePlatformDbPath,
  resolveScanArtifactsDir,
} from "./platform-db";
import { createSqlitePlatformDb } from "./sqlite-db";
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
import { createOrgsRepository, type OrgsRepository } from "./orgs-store";
import { createTeamsRepository, type TeamsRepository } from "./teams-store";
import {
  createProjectSharesRepository,
  type ProjectSharesRepository,
} from "./project-shares-store";
import {
  createAuditLogRepository,
  type AuditLogRepository,
} from "./audit-log-store";
import {
  createScanRecordsStore,
  type ScanRecordsStore,
} from "./scan-records-store";

export interface PlatformStore {
  readonly auth: AuthRepository;
  readonly billing: EntitlementRepository;
  /** H1.1/H1.2: org rows and membership. Membership resolves per request. */
  readonly orgs: OrgsRepository;
  /** P-A2: teams are grantee groupings inside an org, never owners (D-A1). */
  readonly teams: TeamsRepository;
  /** P-A2/D-A6: append-only trail for membership and (from P-A4) grants. */
  readonly audit: AuditLogRepository;
  /** P-A3: grants beside ownership, never instead of it. */
  readonly shares: ProjectSharesRepository;
  projectsFor(ownerId: string): SavedProjectsStore;
  runsFor(ownerId: string): RunHistoryRepository;
  scansFor(ownerId: string): ScanRecordsStore;
  /**
   * Where this store expects scan artifact bytes to live. Exposed so a route
   * can write the file and mkdir the directory -- the row store itself does no
   * filesystem I/O.
   */
  readonly scanArtifactsDir: string;
  isProjectsInitialized(ownerId: string): Promise<boolean>;
  markProjectsInitialized(ownerId: string): Promise<void>;
  close(): Promise<void>;
}

export function createPlatformStore(
  dbPath: string,
  // Overridable so a suite can point artifacts at a temp dir without touching
  // process.env. Unlike the db path there is no `:memory:` equivalent for a
  // directory, so the default is a real path even under NODE_ENV=test.
  artifactsDir: string = resolveScanArtifactsDir(),
): PlatformStore {
  const db = openPlatformDb(dbPath);
  const platformDb = createSqlitePlatformDb(db);
  const ownerState = createOwnerStateStore(platformDb);
  return {
    scanArtifactsDir: artifactsDir,
    auth: createAuthRepository(platformDb),
    billing: createEntitlementRepository(platformDb),
    orgs: createOrgsRepository(platformDb),
    teams: createTeamsRepository(platformDb),
    audit: createAuditLogRepository(platformDb),
    shares: createProjectSharesRepository(platformDb),
    projectsFor(ownerId) {
      return createSavedProjectsStore(platformDb, ownerId);
    },
    runsFor(ownerId) {
      return createRunHistoryRepository(platformDb, ownerId);
    },
    scansFor(ownerId) {
      return createScanRecordsStore(platformDb, ownerId, artifactsDir);
    },
    async isProjectsInitialized(ownerId) {
      return ownerState.isInitialized(ownerId);
    },
    async markProjectsInitialized(ownerId) {
      return ownerState.markInitialized(ownerId);
    },
    close() {
      return platformDb.close();
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

export async function closePlatformStore(): Promise<void> {
  if (singleton) {
    const closing = singleton;
    singleton = null;
    await closing.close();
  }
}
