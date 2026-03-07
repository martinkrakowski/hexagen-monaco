// Main barrel + factory for web-driver bounded context
// Public API surface — all imports from @hexagen/web-driver go through here

export * from './domain';
export * from './infrastructure/adapters';

// Real use-case imports (application layer)
import { PersistSessionIntentHandler } from './application/use-cases/persist-session.intent-handler';
import { DownloadProjectUseCase } from './application/use-cases/download-project.use-case';
import { ProjectViewProjectionUseCase } from './application/use-cases/project-view-projection.use-case';

// Real adapters
import { LocalStoragePersistenceAdapter } from './infrastructure/adapters/local-storage-persistence.adapter';
import { WebContainerPreviewAdapter } from './infrastructure/adapters/webcontainer-preview.adapter';

/**
 * Factory that wires the entire web-driver bounded context.
 * Constructor injection only — no service locator or global state.
 * Called once in wire.ts or root component.
 */
export function createWebUseCaseFactories() {
  // Instantiate concrete adapters once (singleton lifetime for the driver)
  const persistenceAdapter = new LocalStoragePersistenceAdapter();
  const downloadAdapter = new WebContainerPreviewAdapter();

  return {
    // Real handlers/use-cases with injected ports
    createPersistSessionIntentHandler: () =>
      new PersistSessionIntentHandler(persistenceAdapter),

    createDownloadProjectUseCase: () =>
      new DownloadProjectUseCase(downloadAdapter),

    createProjectViewProjectionUseCase: () =>
      new ProjectViewProjectionUseCase(),

    // Expose adapters directly only if needed for rare low-level cases
    persistenceAdapter,
    downloadAdapter,
  };
}

// Type exports for apps/web consumption
export type { Project, MonacoSessionState } from './domain';
export type { MonacoPersistencePort, DownloadProjectPort } from './domain';
