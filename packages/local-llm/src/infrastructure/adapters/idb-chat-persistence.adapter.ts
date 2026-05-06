import { get, set, del } from "idb-keyval";
import type { Result } from "@hexagen/shared";
import type { ChatPersistencePort } from "../../domain/ports/index.js";
import type { ChatMessage } from "../../domain/value-objects/index.js";
import type { GovernanceEntry } from "../../domain/value-objects/index.js";

const CHAT_HISTORY_KEY = "hexagen:chat-history";
const GOVERNANCE_PREFIX = "hexagen:governance:";
const WIZARD_DRAFT_PREFIX = "hexagen:wizard-draft:";
const WORKSPACE_PREFIX = "hexagen:workspace:";
const GENERATION_PREFIX = "hexagen:generation:";

const IDB_DATABASE_NAME = "keyval-store";
const IDB_STORE_NAME = "keyval";

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

function openKeyvalStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_DATABASE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function purgeProjectDataAtomic(projectId: string): Promise<void> {
  return openKeyvalStore().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE_NAME, "readwrite");
        const store = tx.objectStore(IDB_STORE_NAME);

        store.delete(`${WIZARD_DRAFT_PREFIX}${projectId}`);
        store.delete(`${WORKSPACE_PREFIX}${projectId}`);

        const govLower = `${GOVERNANCE_PREFIX}${projectId}-`;
        const govUpper = `${GOVERNANCE_PREFIX}${projectId}-\uffff`;
        store.delete(IDBKeyRange.bound(govLower, govUpper));

        const genLower = `${GENERATION_PREFIX}${projectId}-`;
        const genUpper = `${GENERATION_PREFIX}${projectId}-\uffff`;
        store.delete(IDBKeyRange.bound(genLower, genUpper));

        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      }),
  );
}
