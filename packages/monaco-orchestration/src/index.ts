// Barrel — single source of truth for @hexagen/monaco-orchestration

export * from './domain';
export * from './application/use-cases/apply-semantic-patch.use-case';
export * from './application/use-cases/project-current-buffer-state.use-case';
export * from './application/use-cases/undo-last-patch.use-case';
export * from './application/use-cases/validate-patch-intent.use-case';

export * from './application/ports/in/apply-semantic-patch.port';
export * from './application/ports/in/project-current-buffer-state.port';
export * from './application/ports/in/undo-last-patch.port';
export * from './application/ports/in/validate-patch-intent.port';

// Legacy exports required by web frontend (MonacoEditorWrapper.tsx)
export type MonacoPersistencePort = {
  saveState(data: unknown): Promise<unknown>;
  loadState(data: unknown): Promise<unknown>;
};

export interface MonacoSessionState {
  currentBuffer: string;
  cursorPosition: { line: number; column: number };
  selections: any[];
  lastPatchId?: string;
  version: number;
  isDirty: boolean;
  content?: string;   // ← added for compatibility with MonacoEditorWrapper
}

// Factory functions (for future use)
import { ApplySemanticPatchUseCase } from './application/use-cases/apply-semantic-patch.use-case';
import type { IApplySemanticPatchPort } from './application/ports/in/apply-semantic-patch.port';

export const applySemanticPatchUseCase = (port: IApplySemanticPatchPort) =>
  new ApplySemanticPatchUseCase(port);
