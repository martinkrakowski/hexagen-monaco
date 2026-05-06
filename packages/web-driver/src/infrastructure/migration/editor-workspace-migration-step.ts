import type {
  EditorWorkspacePersistencePort,
  PersistedEditorWorkspace,
  PersistenceDomainRegistryPort,
} from "@hexagen/shared";
import type {
  MigrationStep,
  MigrationResult,
} from "./migration-orchestrator.js";

const WORKSPACE_KEY_PREFIX = "hexagen-editor-workspace-";
const EXPECTED_SCHEMA_VERSION = 1;

export class EditorWorkspaceMigrationStep implements MigrationStep {
  id = "editor-workspace-ls-to-idb";
  description =
    "Migrate editor workspace sessions from localStorage to IndexedDB";

  private editorWorkspacePersistence: EditorWorkspacePersistencePort;
  private domainRegistry: PersistenceDomainRegistryPort;

  constructor(
    editorWorkspacePersistence: EditorWorkspacePersistencePort,
    domainRegistry: PersistenceDomainRegistryPort,
  ) {
    this.editorWorkspacePersistence = editorWorkspacePersistence;
    this.domainRegistry = domainRegistry;
  }

  async migrate(): Promise<MigrationResult> {
    if (typeof window === "undefined") {
      return { success: true, recordsMigrated: 0, errors: [] };
    }

    try {
      const isMigratedResult =
        await this.domainRegistry.isMigrated("editor-workspace");
      if (isMigratedResult.success && isMigratedResult.value) {
        return { success: true, recordsMigrated: 0, errors: [] };
      }

      const workspaceKeys = this.getWorkspaceKeys();
      if (workspaceKeys.length === 0) {
        await this.domainRegistry.markMigrated("editor-workspace");
        return { success: true, recordsMigrated: 0, errors: [] };
      }

      const errors: string[] = [];
      const migrated: {
        sessionId: string;
        workspace: PersistedEditorWorkspace;
      }[] = [];

      for (const key of workspaceKeys) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch (e) {
          errors.push(
            `Key ${key}: ${e instanceof Error ? e.message : "parse error"}`,
          );
          continue;
        }

        if (
          !parsed ||
          typeof parsed !== "object" ||
          !("schemaVersion" in parsed) ||
          typeof (parsed as { schemaVersion: unknown }).schemaVersion !==
            "number"
        ) {
          errors.push(`Key ${key}: missing schemaVersion`);
          continue;
        }

        if (
          (parsed as { schemaVersion: number }).schemaVersion !==
          EXPECTED_SCHEMA_VERSION
        ) {
          errors.push(
            `Key ${key}: expected schemaVersion ${EXPECTED_SCHEMA_VERSION}, got ${(parsed as { schemaVersion: number }).schemaVersion}`,
          );
          continue;
        }

        const sessionId = key.slice(WORKSPACE_KEY_PREFIX.length);
        const workspace = parsed as PersistedEditorWorkspace;

        const saveResult = await this.editorWorkspacePersistence.saveWorkspace(
          sessionId,
          workspace,
        );
        if (!saveResult.success) {
          errors.push(`Key ${key}: failed to write to IndexedDB`);
          continue;
        }

        migrated.push({ sessionId, workspace });
      }

      if (errors.length > 0) {
        return { success: false, recordsMigrated: migrated.length, errors };
      }

      for (const { sessionId, workspace } of migrated) {
        const loadResult =
          await this.editorWorkspacePersistence.loadWorkspace(sessionId);
        if (
          !loadResult.success ||
          !loadResult.value ||
          loadResult.value.sessionId !== workspace.sessionId
        ) {
          errors.push(
            `Session ${sessionId}: verification read-back failed from IndexedDB`,
          );
        }
      }

      if (errors.length > 0) {
        return { success: false, recordsMigrated: 0, errors };
      }

      for (const key of workspaceKeys) {
        localStorage.removeItem(key);
      }

      await this.domainRegistry.markMigrated("editor-workspace");

      return { success: true, recordsMigrated: migrated.length, errors: [] };
    } catch (e) {
      return {
        success: false,
        recordsMigrated: 0,
        errors: [
          e instanceof Error ? e.message : "Failed to migrate editor workspace",
        ],
      };
    }
  }

  async verify(): Promise<boolean> {
    if (typeof window === "undefined") return true;

    const isMigratedResult =
      await this.domainRegistry.isMigrated("editor-workspace");
    if (!isMigratedResult.success || !isMigratedResult.value) return false;

    const workspaceKeys = this.getWorkspaceKeys();
    return workspaceKeys.length === 0;
  }

  private getWorkspaceKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(WORKSPACE_KEY_PREFIX)) {
        keys.push(key);
      }
    }
    return keys;
  }
}
