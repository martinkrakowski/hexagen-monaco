// ============================================================================
// Minimal barrel – public API of monaco-orchestration bounded context
// TEMPORARY: only exports what MonacoEditorWrapper.tsx currently needs.
// Will be expanded and managed by generator later.
// ============================================================================

// Use Cases – VALUE exports (classes, to allow instantiation new UndoLastPatchUseCase())
export { UndoLastPatchUseCase } from './src/application/use-cases/undo-last-patch.use-case';
export { ProjectCurrentBufferStateUseCase } from './src/application/use-cases/project-current-buffer-state.use-case';

// Out Port – type export (interface)
export type { MonacoPersistencePort } from './src/application/ports/out/monaco-persistence.port';

// Session State type (needed for loadSession return type)
export type { MonacoSessionState } from './src/application/ports/out/monaco-persistence.port';

// ────────────────────────────────────────────────────────────────────────────
// Future expansion (uncomment as needed):
// export * from './src/domain/model/monaco-session/monaco-session';
// export * from './src/domain/model/confidence-score/confidence-score';
// ...
