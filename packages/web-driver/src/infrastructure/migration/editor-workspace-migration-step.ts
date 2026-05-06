import type {
  MigrationStep,
  MigrationResult,
} from "./migration-orchestrator.js";

const WORKSPACE_KEY_PREFIX = "hexagen-editor-workspace-";
const EXPECTED_SCHEMA_VERSION = 1;

export class EditorWorkspaceMigrationStep implements MigrationStep {
  id = "editor-workspace-schema-validation";
  description = "Validate editor workspace records have schema version 1";

  async migrate(): Promise<MigrationResult> {
    const workspaceKeys = this.getWorkspaceKeys();
    if (workspaceKeys.length === 0) {
      return { success: true, recordsMigrated: 0, errors: [] };
    }

    let validCount = 0;
    const errors: string[] = [];

    for (const key of workspaceKeys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed.schemaVersion !== "number") {
          errors.push(`Key ${key}: missing schemaVersion`);
          continue;
        }
        if (parsed.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
          errors.push(
            `Key ${key}: expected schemaVersion ${EXPECTED_SCHEMA_VERSION}, got ${parsed.schemaVersion}`,
          );
          continue;
        }
        validCount++;
      } catch (e) {
        errors.push(
          `Key ${key}: ${e instanceof Error ? e.message : "parse error"}`,
        );
      }
    }

    if (errors.length > 0) {
      return { success: false, recordsMigrated: validCount, errors };
    }

    return { success: true, recordsMigrated: validCount, errors: [] };
  }

  async verify(): Promise<boolean> {
    const workspaceKeys = this.getWorkspaceKeys();
    if (workspaceKeys.length === 0) return true;

    for (const key of workspaceKeys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      try {
        const parsed = JSON.parse(raw);
        if (parsed.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
          return false;
        }
      } catch {
        return false;
      }
    }

    return true;
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
