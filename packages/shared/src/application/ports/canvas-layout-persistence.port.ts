import type { Result } from "../../errors/result.js";
import type { PersistenceError } from "../../domain/persistence-error.js";
import type { PersistedCanvasLayout } from "../../domain/persisted-canvas-layout.js";

export interface CanvasLayoutPersistencePort {
  saveCanvasLayout(
    sessionId: string,
    layout: PersistedCanvasLayout,
  ): Promise<Result<void, PersistenceError>>;

  loadCanvasLayout(
    sessionId: string,
  ): Promise<Result<PersistedCanvasLayout | null, PersistenceError>>;

  clearCanvasLayout(sessionId: string): Promise<Result<void, PersistenceError>>;
}
