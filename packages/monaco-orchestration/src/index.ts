// Domain models (entities & value objects)
export * from './domain/model/monaco-session/monaco-session';

// Application layer – use cases
export * from './application/use-cases/apply-semantic-patch.use-case';
export * from './application/use-cases/validate-patch-intent.use-case';
export * from './application/use-cases/undo-last-patch.use-case';
export * from './application/use-cases/project-current-buffer-state.use-case';

// Ports (outbound)
export * from './application/ports/out/monaco-session-repository.port';
export * from './application/ports/out/monaco-editor-react.port';
export * from './application/ports/out/ts-morph.port';
export * from './application/ports/out/local-storage.port';

// Inbound ports
export * from './application/ports/in/apply-semantic-patch.port';
export * from './application/ports/in/validate-patch-intent.port';
export * from './application/ports/in/undo-last-patch.port';
export * from './application/ports/in/project-current-buffer-state.port';
