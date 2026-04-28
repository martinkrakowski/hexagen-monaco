import { get, set, del, keys } from "idb-keyval";
import type { Result } from "@hexagen/shared";
import type { ChatPersistencePort } from "../../domain/ports/index.js";
import type { ChatMessage } from "../../domain/value-objects/index.js";
import type { GovernanceEntry } from "../../domain/value-objects/index.js";

const CHAT_HISTORY_KEY = "hexagen:chat-history";
const GOVERNANCE_PREFIX = "hexagen:governance:";
const WIZARD_DRAFT_PREFIX = "hexagen:wizard-draft:";
const WORKSPACE_PREFIX = "hexagen:workspace:";

/**
 * IndexedDB adapter for chat persistence via idb-keyval.
 * Stores chat messages and governance threads in browser's persistent storage.
 */
export class IDBChatPersistenceAdapter implements ChatPersistencePort {
  async loadChatHistory(): Promise<Result<ChatMessage[]>> {
    try {
      const data = await get(CHAT_HISTORY_KEY);
      return { success: true, value: data ?? [] };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  async saveChatHistory(messages: ChatMessage[]): Promise<Result<void>> {
    try {
      await set(CHAT_HISTORY_KEY, messages);
      return { success: true, value: undefined };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  async clearChatHistory(): Promise<Result<void>> {
    try {
      await del(CHAT_HISTORY_KEY);
      return { success: true, value: undefined };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  async loadGovernanceThread(
    contextKey: string,
  ): Promise<Result<GovernanceEntry[]>> {
    try {
      const key = GOVERNANCE_PREFIX + contextKey;
      const data = await get(key);
      return { success: true, value: data ?? [] };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  async saveGovernanceThread(
    contextKey: string,
    entries: GovernanceEntry[],
  ): Promise<Result<void>> {
    try {
      const key = GOVERNANCE_PREFIX + contextKey;
      await set(key, entries);
      return { success: true, value: undefined };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  async clearGovernanceThread(contextKey: string): Promise<Result<void>> {
    try {
      const key = GOVERNANCE_PREFIX + contextKey;
      await del(key);
      return { success: true, value: undefined };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }

  /**
   * Purge all project-scoped data from IndexedDB.
   * Called when user discards a project to prevent state leakage.
   *
   * Deletes:
   * - Wizard drafts: hexagen:wizard-draft:{projectId}
   * - Governance threads: hexagen:governance:{projectId}-*
   * - Workspace state: hexagen:workspace:{projectId}
   *
   * @param projectId - Unique identifier of the project to purge
   * @returns Result indicating success or failure
   */
  async purgeProjectData(projectId: string): Promise<Result<void>> {
    try {
      // Get all keys from IndexedDB
      const allKeys = await keys();

      // Filter keys that belong to this project
      const projectKeys = allKeys.filter((key) => {
        const keyStr = String(key);
        return (
          keyStr === `${WIZARD_DRAFT_PREFIX}${projectId}` ||
          keyStr === `${WORKSPACE_PREFIX}${projectId}` ||
          keyStr.startsWith(`${GOVERNANCE_PREFIX}${projectId}-`)
        );
      });

      // Delete all project-scoped keys
      await Promise.all(projectKeys.map((key) => del(key)));

      return { success: true, value: undefined };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }
}
