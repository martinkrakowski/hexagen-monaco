// Main barrel + factory for web-driver bounded context
// Public API surface — only export local things

// Re-export domain entities (pure)
export * from "./domain";

// Re-export use-cases (application layer)
export * from "./application/use-cases";

// Re-export infrastructure adapters (if intentionally public)
export * from "./infrastructure/adapters";

// Factory that wires the entire web-driver bounded context
import { LocalStoragePersistenceAdapter } from "./infrastructure/adapters/local-storage-persistence.adapter";

import { PersistSessionIntentHandler } from "./application/use-cases/persist-session.intent-handler";
import { ProjectViewProjectionUseCase } from "./application/use-cases/project-view-projection.use-case";

export function createWebUseCaseFactories() {
  const persistenceAdapter = new LocalStoragePersistenceAdapter();

  return {
    createPersistSessionIntentHandler: () =>
      new PersistSessionIntentHandler(persistenceAdapter),
    createProjectViewProjectionUseCase: () =>
      new ProjectViewProjectionUseCase(),
    persistenceAdapter,
  };
}

// Type exports for apps/web consumption
export type { Project } from "./domain/project.entity";
export type { MonacoSessionState } from "./domain/monaco-session-state.vo";
