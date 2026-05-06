import { get, set, del, keys } from "idb-keyval";
import type {
  GenerationResult,
  GenerationResultPersistencePort,
  PersistenceError,
  Result,
} from "@hexagen/shared";

const GENERATION_KEY_PREFIX = "hexagen:generation:";

function makeKey(projectId: string, timestamp: number): string {
  return `${GENERATION_KEY_PREFIX}${projectId}-${timestamp}`;
}

export class IDBGenerationResultAdapter implements GenerationResultPersistencePort {
  async saveResult(
    result: GenerationResult,
  ): Promise<Result<void, PersistenceError>> {
    try {
      const key = makeKey(result.projectId, result.timestamp);
      await set(key, result);
      return { success: true, value: undefined };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: "SerializationFailed" as const,
          message: "Failed to save generation result",
          cause: e,
        },
      };
    }
  }

  async loadResults(
    projectId: string,
  ): Promise<Result<GenerationResult[], PersistenceError>> {
    try {
      const allKeys = (await keys()) as string[];
      const prefix = `${GENERATION_KEY_PREFIX}${projectId}-`;
      const projectKeys = allKeys.filter((k) => k.startsWith(prefix));

      const results: GenerationResult[] = [];
      for (const key of projectKeys) {
        const data = (await get(key)) as GenerationResult | undefined;
        if (data) results.push(data);
      }

      results.sort((a, b) => b.timestamp - a.timestamp);
      return { success: true, value: results };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: "DeserializationFailed" as const,
          message: "Failed to load generation results",
          cause: e,
        },
      };
    }
  }

  async deleteResult(
    projectId: string,
    timestamp: number,
  ): Promise<Result<void, PersistenceError>> {
    try {
      const key = makeKey(projectId, timestamp);
      await del(key);
      return { success: true, value: undefined };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: "Unknown" as const,
          message: "Failed to delete generation result",
          cause: e,
        },
      };
    }
  }

  async purgeProjectResults(
    projectId: string,
  ): Promise<Result<void, PersistenceError>> {
    try {
      const allKeys = (await keys()) as string[];
      const prefix = `${GENERATION_KEY_PREFIX}${projectId}-`;
      const projectKeys = allKeys.filter((k) => k.startsWith(prefix));

      for (const key of projectKeys) {
        await del(key);
      }
      return { success: true, value: undefined };
    } catch (e) {
      return {
        success: false,
        error: {
          kind: "Unknown" as const,
          message: "Failed to purge generation results",
          cause: e,
        },
      };
    }
  }
}
