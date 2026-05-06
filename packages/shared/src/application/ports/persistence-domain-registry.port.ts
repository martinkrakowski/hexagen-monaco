import type { Result } from "../../errors/result.js";
import type { PersistenceError } from "../../domain/persistence-error.js";
import type { PersistenceDomain } from "../../domain/persistence-domain.js";

export interface PersistenceDomainRegistryPort {
  getActiveBackend(domain: PersistenceDomain): "localStorage" | "indexedDB";
  markMigrated(
    domain: PersistenceDomain,
  ): Promise<Result<void, PersistenceError>>;
  isMigrated(
    domain: PersistenceDomain,
  ): Promise<Result<boolean, PersistenceError>>;
  getAllDomains(): PersistenceDomain[];
}
