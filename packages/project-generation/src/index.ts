// Domain exports
export { Project } from "./domain/entities/project.js";

// Value objects exports
export { ProjectSpecification } from "./domain/value-objects/project-specification.js";

// Application exports
export { ExportError } from "./application/generate-project-use-case.js";
export { InitiateExportUseCase } from "./application/use-cases/initiate-export.use-case.js";
export type { GenerateProjectUseCaseFactory } from "./application/use-cases/initiate-export.use-case.js";
export type {
  GenerateProjectInput,
  GenerateProjectOutput,
} from "./application/generate-project-use-case.js";
/**
 * The manifest shape this context's ports speak (HEX-004). Exported so callers
 * can name it without reaching for the engine's `Manifest` — an engine manifest
 * is assignable to it, so existing call sites need no change.
 */
export type { GenerationManifest } from "./application/generation-manifest.js";

export type { RunProjectGenerationPort } from "./application/ports/in/generate-project.port.js";
export type {
  InitiateExportPort,
  ExportIntent,
  ExportTarget,
  ExportValue,
  ZipExportValue,
  GitHubExportValue,
  WorkspaceRef,
} from "./application/ports/in/initiate-export.port.js";

// Ports exports (interfaces)
export type { ExternalProjectGeneratorPort } from "./application/ports/out/external-project-generator.port.js";
export type {
  ZipCreatorPort,
  ZipCreatorError,
} from "./application/ports/out/zip-creator.port.js";
export type {
  ExportConfig,
  ExportDestination,
  ExportErrorCode,
  ExportResult,
  GitHubExportConfig,
  ProjectExporterPort,
} from "./application/ports/out/project-exporter.port.js";
export type {
  AddOnMaterializerPort,
  AddOnAnswers,
  AddOnAnswerValue,
  MaterializeResult,
} from "./application/ports/out/add-on-materializer.port.js";
export type {
  ProjectWorkspace,
  ProjectWorkspacePort,
} from "./application/ports/out/project-workspace.port.js";

// Conformance gate files — the workflow + vendored composite action + D-B4
// install doc. Exported because the brownfield "install the gate" route in
// apps/web builds its leave-behind zip from exactly these bytes, and this
// package's `exports` map has a single "." entry (no deep-import path).
export {
  HEXAGEN_GATE_INSTALL_DOC,
  HEXAGEN_GATE_INSTALL_DOC_PATH,
  HEXAGEN_TOOLCHAIN_RANGE,
  hexagenConformanceActionFiles,
  hexagenGateBundleFiles,
} from "./domain/conformance-gate-files.js";
export type {
  ConformanceGateFile,
  ConformanceGateFilesOptions,
} from "./domain/conformance-gate-files.js";

// Infrastructure exports (implementations)
export { ExternalSyncEngineAdapter } from "./infrastructure/adapters/external-sync-engine.adapter.js";
export { JsZipCreatorAdapter } from "./infrastructure/adapters/jszip-creator.adapter.js";
export { ArchiveExporterAdapter } from "./infrastructure/adapters/archive-exporter.adapter.js";
export { ScratchDirProjectWorkspaceAdapter } from "./infrastructure/adapters/scratch-dir-project-workspace.adapter.js";

// Composition root
import { GenerateProjectUseCase as ApplicationGenerateProjectUseCase } from "./application/generate-project-use-case.js";
import type { ExternalProjectGeneratorPort } from "./application/ports/out/external-project-generator.port.js";
import type { ProjectExporterPort } from "./application/ports/out/project-exporter.port.js";
import type { AddOnMaterializerPort } from "./application/ports/out/add-on-materializer.port.js";
import type { ProjectWorkspacePort } from "./application/ports/out/project-workspace.port.js";
import { ScratchDirProjectWorkspaceAdapter } from "./infrastructure/adapters/scratch-dir-project-workspace.adapter.js";

/**
 * `GenerateProjectUseCase` with its driven ports' production bindings applied
 * (HEX-002).
 *
 * The application class requires a {@link ProjectWorkspacePort} outright — it
 * owns no filesystem and must not pretend to. Defaulting that binding is a
 * composition-root job, and this barrel is this package's composition root (it
 * is the only module here that already reaches across into `infrastructure/`).
 * Binding it here rather than inside the use case keeps the application layer
 * free of adapter imports while leaving every existing call site — which passes
 * a generator, an exporter and an optional materializer — working unchanged.
 *
 * Pass `workspace` explicitly to run generation somewhere other than a temp
 * directory; the test suite does exactly that with an in-memory workspace.
 */
export class GenerateProjectUseCase extends ApplicationGenerateProjectUseCase {
  constructor(
    generator: ExternalProjectGeneratorPort,
    exporter: ProjectExporterPort,
    materializer?: AddOnMaterializerPort,
    workspace: ProjectWorkspacePort = new ScratchDirProjectWorkspaceAdapter(),
  ) {
    super(generator, exporter, materializer, workspace);
  }
}

// Factory functions
export const generateProjectUseCase = (
  generator: ExternalProjectGeneratorPort,
  exporter: ProjectExporterPort,
) => new GenerateProjectUseCase(generator, exporter);
