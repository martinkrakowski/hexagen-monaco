import { get, set, del } from "idb-keyval";
import type { Result } from "@hexagen/shared";
import type { ChatPersistencePort } from "../../domain/ports/index.js";
import type { ChatMessage } from "../../domain/value-objects/index.js";
import type { GovernanceEntry } from "../../domain/value-objects/index.js";

const CHAT_HISTORY_KEY = "hexagen:chat-history";
const GOVERNANCE_PREFIX = "hexagen:governance:";

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
}
