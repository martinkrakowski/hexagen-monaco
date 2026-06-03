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

// Generated-bundle factory: the serverless-safe materializer for the web path.
// `buildTemplateBundle` (imports node:fs) is intentionally NOT re-exported here —
// it's only used by the generator script + parity test, which import it directly.
// Keeping it off the public barrel avoids dragging node:fs into a client bundle.
export { createInMemoryMaterializer } from "./create-in-memory-materializer.js";
