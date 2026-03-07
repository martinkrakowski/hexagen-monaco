// Main barrel + factory for web-driver bounded context

export * from './domain';
export * from './infrastructure/adapters';

// Temporary stubs for missing use-cases (remove once implemented)
class StubUseCase {
  constructor(private adapter?: any) {}
  async execute(...args: any[]): Promise<any> {
    console.warn('Stub use-case called – implement real version');
    return { success: true, message: 'Stub response' };
  }
}

export function createWebUseCaseFactories() {
  // Real adapters (these should resolve now that barrels are in place)
  const persistenceAdapter = new LocalStoragePersistenceAdapter();
  const downloadAdapter = new WebContainerPreviewAdapter();

  return {
    createPersistSessionIntentHandler: () =>
      new StubUseCase(persistenceAdapter),
    createDownloadProjectUseCase: () => new StubUseCase(downloadAdapter),
    createProjectViewProjectionUseCase: () => new StubUseCase(),

    persistenceAdapter,
    downloadAdapter,
  };
}

export type { Project, MonacoSessionState } from './domain';
export type { MonacoPersistencePort, DownloadProjectPort } from './domain';
