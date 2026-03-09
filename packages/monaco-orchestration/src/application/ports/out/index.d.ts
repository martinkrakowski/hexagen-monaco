/**
 * Barrel file exporting all outbound ports for the monaco-orchestration bounded context.
 *
 * Use this barrel for all outbound port imports from application/use-cases.
 *
 * Active / canonical:
 * - monaco-persistence.port     → session persistence (preferred over legacy local-storage)
 *
 * Legacy / to be phased out (keep until migration complete):
 * - semantic-model-adapter-port.port
 * - ts-morph.port
 */
export * from './monaco-persistence.port';
export * from './semantic-model-adapter-port.port';
export * from './ts-morph.port';
//# sourceMappingURL=index.d.ts.map