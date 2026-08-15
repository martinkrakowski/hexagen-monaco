import type {
  PersistenceDomain,
  PersistenceDomainRegistryPort,
  PersistenceError,
  Result,
} from "@hexagen/shared";

const MIGRATION_FLAG_PREFIX = "hexagen:persistence-domain:migrated:";

const ALL_DOMAINS: PersistenceDomain[] = [
  "wizard-draft",
  "saved-projects",
  "editor-workspace",
  "generation-results",
  "chat-threads",
  "canvas-layout",
  "monaco-state",
  "model-preferences",
];

export class PersistenceDomainRegistry implements PersistenceDomainRegistryPort {
  async markMigrated(
    domain: PersistenceDomain,
  ): Promise<Result<void, PersistenceError>> {
    try {
      if (typeof window === "undefined")
        return { success: true, value: undefined };
      localStorage.setItem(`${MIGRATION_FLAG_PREFIX}${domain}`, "true");
      return { success: true, value: undefined };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: "Unknown",
          message: `Failed to mark domain ${domain} as migrated`,
          cause: e,
        },
      };
    }
  }

  async isMigrated(
    domain: PersistenceDomain,
  ): Promise<Result<boolean, PersistenceError>> {
    try {
      if (typeof window === "undefined") return { success: true, value: false };
      const flag = localStorage.getItem(`${MIGRATION_FLAG_PREFIX}${domain}`);
      return { success: true, value: flag === "true" };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: "Unknown",
          message: `Failed to check migration status for domain ${domain}`,
          cause: e,
        },
      };
    }
  }

  getAllDomains(): PersistenceDomain[] {
    return [...ALL_DOMAINS];
  }
}
