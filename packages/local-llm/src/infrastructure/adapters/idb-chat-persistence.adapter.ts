import { del, delMany, get, keys, set } from "idb-keyval";
import type { Result } from "@hexagen/shared";
import type { ChatPersistencePort } from "../../domain/ports/index.js";
import type { ChatMessage } from "../../domain/value-objects/index.js";
import type { GovernanceEntry } from "../../domain/value-objects/index.js";

const CHAT_HISTORY_KEY = "hexagen:chat-history";
const GOVERNANCE_PREFIX = "hexagen:governance:";
const WIZARD_DRAFT_PREFIX = "hexagen:wizard-draft:";
const WORKSPACE_PREFIX = "hexagen:workspace:";
const GENERATION_PREFIX = "hexagen:generation:";

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
 * Purge every key belonging to `projectId` in one transaction.
 *
 * Built on idb-keyval's `keys()` + a single `delMany(...)` so the whole
 * delete set commits atomically (ADR-0029: the deletes are all-or-nothing,
 * not a sequence of independent `del` calls). The trailing `-` on the
 * governance/generation range prefixes is what stops `P` from matching a
 * sibling `P2-...`.
 */
async function purgeProjectDataAtomic(projectId: string): Promise<void> {
  const allKeys = await keys();
  const toDelete: string[] = [];
  for (const key of allKeys) {
    if (typeof key !== "string") continue;
    if (
      key === `${WIZARD_DRAFT_PREFIX}${projectId}` ||
      key === `${WORKSPACE_PREFIX}${projectId}` ||
      key.startsWith(`${GOVERNANCE_PREFIX}${projectId}-`) ||
      key.startsWith(`${GENERATION_PREFIX}${projectId}-`)
    ) {
      toDelete.push(key);
    }
  }
  if (toDelete.length > 0) {
    await delMany(toDelete);
  }
}
