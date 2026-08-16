import type { ExternalProjectGeneratorPort } from "./ports/out/external-project-generator.port.js";
import type {
  ExportConfig,
  ExportErrorCode,
  ProjectExporterPort,
} from "./ports/out/project-exporter.port.js";
import type {
  AddOnAnswers,
  AddOnMaterializerPort,
} from "./ports/out/add-on-materializer.port.js";
import type { Project } from "../domain/entities/project.js";
import {
  SYNC_INTEGRITY_WORKFLOW,
  SYNC_INTEGRITY_WORKFLOW_PATH,
  shouldInjectSyncIntegrityWorkflow,
} from "../domain/sync-integrity-workflow.js";
import type {
  ProjectWorkspace,
  ProjectWorkspacePort,
} from "./ports/out/project-workspace.port.js";
import { toWorkspaceSegments } from "../domain/workspace-path.js";
import type { GenerationManifest } from "./generation-manifest.js";
import type { Result } from "@hexagen/shared";

/**
 * Filename of the in-artifact notice written when an add-on selection fails
 * (Decision A1) — so a ZIP / GitHub consumer learns why their add-ons are
 * absent without opening the app. Errors only; warnings surface in the UI.
 */
const ADD_ON_NOTICES_FILE = "HEXAGEN-ADDON-NOTICES.md";
/**
 * Where the archive exporter leaves the ZIP it built, read back out of the
 * workspace for the `zipBuffer` the download route streams.
 */
const ARCHIVE_ENTRY = ["project.zip"] as const;
/** Cap rendered notices so a request with very many bad add-on keys can't bloat
 * the artifact (per-error length is also capped in `toNoticeItem`). */
const MAX_RENDERED_NOTICES = 50;

/**
 * Render an error as a single, Markdown-safe list item. The error text can embed
 * template ids derived from untrusted request keys, so: collapse whitespace /
 * newlines (can't break the list structure), cap the length (can't bloat the
 * artifact), neutralize backticks, and wrap in inline code so any links or
 * emphasis stay literal in the rendered HEXAGEN-ADDON-NOTICES.md.
 */
function toNoticeItem(error: unknown): string {
  // The materializer is an injected port, so coerce defensively: a non-string
  // crossing the boundary must not crash the request on `.replace`.
  const text = typeof error === "string" ? error : String(error);
  const oneLine = text.replace(/\s+/g, " ").trim();
  const capped = oneLine.length > 300 ? `${oneLine.slice(0, 300)}…` : oneLine;
  return `- \`${capped.replace(/`/g, "'")}\``;
}

/**
 * Workspace path segments for a project-relative file key, or a throw when the
 * key would land outside the project. The emitter already enforces this, so
 * reaching the throw is a should-never-happen bug, not user input — but the
 * check stays on this side of the port so no workspace implementation has to be
 * trusted with it.
 */
function containedSegmentsOrThrow(rel: string): readonly string[] {
  const segments = toWorkspaceSegments(rel);
  if (!segments) {
    throw new Error(`Add-on file path escapes project root: ${rel}`);
  }
  return segments;
}

function renderAddOnNotices(errors: string[]): string {
  const shown = errors.slice(0, MAX_RENDERED_NOTICES);
  const overflow = errors.length - shown.length;
  return [
    "# Add-on templates were not applied",
    "",
    "Some add-on selections could not be materialized, so this project contains",
    "only the core scaffold. **This file is safe to delete.**",
    "",
    "## Problems",
    ...shown.map(toNoticeItem),
    ...(overflow > 0 ? [`- …and ${overflow} more`] : []),
    "",
  ].join("\n");
}

/**
 * Export failure carrying the exporter's typed {@link ExportErrorCode}, so API
 * routes can map failure classes (e.g. `workflow-scope-missing` → HTTP 403 +
 * `workflow_scope_required`) instead of sentinel-substring matching on the
 * message text.
 */
export class ExportError extends Error {
  constructor(
    message: string,
    readonly code?: ExportErrorCode,
  ) {
    super(message);
    this.name = "ExportError";
  }
}

export interface GenerateProjectInput {
  manifest: GenerationManifest;
  exportConfig: ExportConfig;
  /**
   * Per-template wizard answers. When present (and a materializer is wired),
   * the selected add-on templates are materialized and merged into the
   * generated project (template-overrides-core).
   */
  addOnsAnswers?: AddOnAnswers;
  /**
   * Emit add-on test scaffolds (`*.test.*` / `*.spec.*`) — the `--with-tests`
   * gate. Off by default; threaded to the materializer. (No web toggle wired yet;
   * the mechanism is in place for a CLI flag / generation toggle to set it.)
   */
  withTests?: boolean;
}

export interface GenerateProjectOutput {
  project: Project;
  destinationUrl: string;
  /** Branch the project was committed to (GitHub export). */
  defaultBranch?: string;
  zipBuffer?: Buffer;
  /** Add-on materialization notices (e.g. a template overrode a generated file). */
  warnings?: string[];
  /**
   * Add-on selection problems (unknown / conflicting / cyclic). The core
   * project still generated — these are surfaced here, not thrown.
   */
  errors?: string[];
}

export class GenerateProjectUseCase {
  constructor(
    private readonly generator: ExternalProjectGeneratorPort,
    private readonly exporter: ProjectExporterPort,
    private readonly materializer: AddOnMaterializerPort | undefined,
    /**
     * Where the run happens (HEX-002). Required: this use case owns no
     * filesystem of its own, so there is no sane default to fall back to. The
     * package's composition root (`src/index.ts`) binds the scratch-dir adapter
     * for callers that construct the barrel export.
     */
    private readonly workspaceProvider: ProjectWorkspacePort,
  ) {}

  async execute(
    input: GenerateProjectInput,
  ): Promise<Result<GenerateProjectOutput, Error>> {
    const workspace = await this.workspaceProvider.open();

    try {
      const genResult = await this.generator.generateAt(
        workspace.reference,
        input.manifest,
      );

      if (!genResult.success) {
        return {
          success: false,
          error: new Error(genResult.error.message),
        };
      }

      let project = genResult.value;
      const warnings: string[] = [];
      let errors: string[] = [];

      // Auto-inject the architectural-integrity workflow (`yarn sync:check`) so a
      // generated project keeps its hexagonal structure enforced in CI. Re-wires
      // the feature dropped when generation moved to the new ports. Written as a
      // core file BEFORE add-ons, so an add-on may override it (with a warning).
      if (
        shouldInjectSyncIntegrityWorkflow(
          input.manifest.monorepo?.packageManager,
        )
      ) {
        await this.writeIntoWorkspace(
          workspace,
          SYNC_INTEGRITY_WORKFLOW_PATH,
          SYNC_INTEGRITY_WORKFLOW,
        );
        project = project.withAdditionalFiles(
          new Map([[SYNC_INTEGRITY_WORKFLOW_PATH, SYNC_INTEGRITY_WORKFLOW]]),
        );
      }

      const addOnsAnswers = input.addOnsAnswers;
      if (
        this.materializer &&
        addOnsAnswers &&
        Object.keys(addOnsAnswers).length > 0
      ) {
        const materialized = await this.materializer.materialize(
          addOnsAnswers,
          {
            // The resolved project name (set during manifest assembly), so a
            // template default like "{projectName}" matches generated file content.
            projectName: input.manifest.system,
            withTests: input.withTests,
          },
        );
        warnings.push(...materialized.warnings);
        errors = materialized.errors;

        // A bad selection comes back as `errors` with no files — skip the merge
        // and let the core project still ship, errors surfaced (not thrown).
        if (materialized.files.size > 0) {
          await this.mergeAddOnFilesIntoWorkspace(
            workspace,
            project,
            materialized.files,
            warnings,
          );
          // Mirror the on-disk merge into the in-memory map the code view reads.
          project = project.withAdditionalFiles(materialized.files);
        }

        // Bad selection (errors, no files): write a notices file into the
        // artifact so a ZIP / GitHub consumer learns why their add-ons are
        // absent — the binary download can't carry the errors payload. Warnings
        // get no sidecar (they surface in the UI). The `files.size === 0` guard
        // keeps a future partial-output contract from writing a misleading
        // "not applied" notice into an export that does contain add-on files.
        if (errors.length > 0 && materialized.files.size === 0) {
          const notice = new Map([
            [ADD_ON_NOTICES_FILE, renderAddOnNotices(errors)],
          ]);
          await this.mergeAddOnFilesIntoWorkspace(
            workspace,
            project,
            notice,
            warnings,
          );
          project = project.withAdditionalFiles(notice);
        }
      }

      const exportResult = await this.exporter.export(
        workspace.reference,
        input.exportConfig,
      );

      if (!exportResult.success) {
        return {
          success: false,
          // ExportError preserves the exporter's typed errorCode across the
          // Result<_, Error> boundary the routes consume.
          error: new ExportError(
            exportResult.error ?? "Export failed",
            exportResult.errorCode,
          ),
        };
      }

      // Exporter notices (e.g. workflow files skipped for a scope-less token)
      // join the add-on warnings already surfaced to the UI.
      if (exportResult.warnings?.length) {
        warnings.push(...exportResult.warnings);
      }

      let zipBuffer: Buffer | undefined;
      if (input.exportConfig.destination === "archive") {
        try {
          const archive = await workspace.readBytes(ARCHIVE_ENTRY);
          // The port speaks `Uint8Array` so a non-filesystem workspace can
          // satisfy it; the public contract (`ZipExportValue.zip`, the
          // `/api/generate` response) is `Buffer`. Same bytes, no re-encode.
          if (archive) zipBuffer = Buffer.from(archive);
        } catch {
          // Archive export might not create a zip file if streaming directly
        }
      }

      return {
        success: true,
        value: {
          project,
          destinationUrl: exportResult.destinationUrl,
          defaultBranch: exportResult.defaultBranch,
          zipBuffer,
          warnings: warnings.length > 0 ? warnings : undefined,
          errors: errors.length > 0 ? errors : undefined,
        },
      };
    } finally {
      try {
        await workspace.release();
      } catch {
        // Best effort cleanup. The port asks implementations not to reject,
        // but it is injected, so a badly-behaved one must not turn a
        // successful generation into a failed request.
      }
    }
  }

  /**
   * Place a file in the workspace so the ZIP / GitHub export captures it.
   *
   * Containment is decided HERE, not in the workspace: `toWorkspaceSegments`
   * rejects any key that would land outside the project, so an escaping key is
   * never handed to an implementation that might be lenient about it. What the
   * adapter still owns is the hazard only a real filesystem has — writing
   * through a symlink.
   */
  private async writeIntoWorkspace(
    workspace: ProjectWorkspace,
    rel: string,
    content: string,
  ): Promise<void> {
    await workspace.writeText(containedSegmentsOrThrow(rel), content);
  }

  /**
   * Write each materialized add-on file into the workspace (so the ZIP / GitHub
   * export captures it) with template-overrides-core precedence, recording a
   * warning for every generated file an add-on replaces. Runs **after**
   * `generateAt` and **before** `export`. The matching merge into the in-memory
   * `project.files` (for the code view) is done by the caller via
   * `Project.withAdditionalFiles`.
   */
  private async mergeAddOnFilesIntoWorkspace(
    workspace: ProjectWorkspace,
    project: Project,
    files: ReadonlyMap<string, string>,
    warnings: string[],
  ): Promise<void> {
    for (const [rel, content] of files) {
      // Containment first, exactly as before: an escaping key aborts the run
      // rather than being announced as an override on its way out.
      const segments = containedSegmentsOrThrow(rel);
      if (project.files.has(rel)) {
        warnings.push(`Add-on template overrides generated file: ${rel}`);
      }
      await workspace.writeText(segments, content);
    }
  }
}
