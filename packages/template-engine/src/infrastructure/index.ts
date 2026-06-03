export { FileSystemTemplateRegistry } from "./template-registry.adapter.js";
export { InteractiveQuestionEngine } from "./question-engine.adapter.js";
export { FileSystemFileEmitter } from "./file-emitter.adapter.js";
export { FileSystemTemplateConfigStore } from "./template-config-store.adapter.js";

// In-memory adapters for headless materialization (web code-view / ZIP / GitHub).
export { InMemoryFileEmitter } from "./in-memory-file-emitter.adapter.js";
export type { TemplateFileLoader } from "./in-memory-file-emitter.adapter.js";
export { InMemoryTemplateConfigStore } from "./in-memory-template-config-store.adapter.js";
export { DefaultingQuestionEngine } from "./defaulting-question-engine.adapter.js";
export { createFileSystemTemplateFileLoader } from "./file-system-template-file-loader.js";
export { InMemoryAddOnMaterializer } from "./in-memory-add-on-materializer.js";
export type { MaterializeAddOnsResult } from "./in-memory-add-on-materializer.js";

// NOTE: createInMemoryMaterializer is intentionally NOT exported from this barrel.
// It imports the generated bundle, which parses ~0.7 MB at module init, and
// `buildTemplateBundle` imports node:fs. Re-exporting either here would pull both
// into the package root's module graph — so every consumer of `@hexagen/template-engine`
// (e.g. the sync CLI) would eagerly load them even when unused. The factory lives
// behind the dedicated subpath `@hexagen/template-engine/in-memory` instead.
