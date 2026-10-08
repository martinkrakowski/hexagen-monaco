import { createStore, del, get, promisifyRequest, set } from "idb-keyval";
import type { Result } from "@hexagen/shared";
import type { ChatPersistencePort } from "../../domain/ports/index.js";
import type { ChatMessage } from "../../domain/value-objects/index.js";
import type { GovernanceEntry } from "../../domain/value-objects/index.js";

const CHAT_HISTORY_KEY = "hexagen:chat-history";
const GOVERNANCE_PREFIX = "hexagen:governance:";
const WIZARD_DRAFT_PREFIX = "hexagen:wizard-draft:";
const WORKSPACE_PREFIX = "hexagen:workspace:";
const GENERATION_PREFIX = "hexagen:generation:";

const keyvalStore = createStore("keyval-store", "keyval");

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

  async purgeProjectData(projectId: string): Promise<Result<void>> {
    try {
      await purgeProjectDataAtomic(projectId);
      return { success: true, value: undefined };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }
  }
}

/**
 * Purge every key belonging to `projectId` in ONE read-write transaction.
 *
 * `keys()` + `delMany()` would be two transactions (a thread saved between a
 * listing and the delete survives the purge), so the deletes are issued
 * directly on a single `store("readwrite", …)` opened via `createStore`. The
 * trailing `-` on the governance/generation range bounds is what stops `P`
 * from matching a sibling `P2-…`. (ADR-0029: the deletes are all-or-nothing.)
 */
async function purgeProjectDataAtomic(projectId: string): Promise<void> {
  return keyvalStore("readwrite", (objectStore) => {
    objectStore.delete(`${WIZARD_DRAFT_PREFIX}${projectId}`);
    objectStore.delete(`${WORKSPACE_PREFIX}${projectId}`);
    objectStore.delete(
      IDBKeyRange.bound(
        `${GOVERNANCE_PREFIX}${projectId}-`,
        `${GOVERNANCE_PREFIX}${projectId}-\uffff`,
      ),
    );
    objectStore.delete(
      IDBKeyRange.bound(
        `${GENERATION_PREFIX}${projectId}-`,
        `${GENERATION_PREFIX}${projectId}-\uffff`,
      ),
    );
    return promisifyRequest(objectStore.transaction);
  });
}
