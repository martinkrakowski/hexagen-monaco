import type { Result } from "../../errors/result.js";
import type { PersistenceError } from "../../domain/persistence-error.js";
import type { GenerationResult } from "../../domain/types/generation-result.js";

export interface GenerationResultPersistencePort {
  saveResult(result: GenerationResult): Promise<Result<void, PersistenceError>>;
  loadResults(
    projectId: string,
  ): Promise<Result<GenerationResult[], PersistenceError>>;
  deleteResult(
    projectId: string,
    timestamp: number,
  ): Promise<Result<void, PersistenceError>>;
  purgeProjectResults(
    projectId: string,
  ): Promise<Result<void, PersistenceError>>;
}
