import type { ExternalProjectGeneratorPort } from "./ports/out/external-project-generator.port.js";
import type {
  ExportConfig,
  ProjectExporterPort,
} from "./ports/out/project-exporter.port.js";
import type {
  AddOnAnswers,
  AddOnMaterializerPort,
} from "./ports/out/add-on-materializer.port.js";
import type { Project } from "../domain/entities/project.js";
import type { Manifest } from "@hexagen/sync";
import type { Result } from "@hexagen/shared";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * Filename of the in-artifact notice written when an add-on selection fails
 * (Decision A1) — so a ZIP / GitHub consumer learns why their add-ons are
 * absent without opening the app. Errors only; warnings surface in the UI.
 */
const ADD_ON_NOTICES_FILE = "HEXAGEN-ADDON-NOTICES.md";
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
function toNoticeItem(error: string): string {
  const oneLine = error.replace(/\s+/g, " ").trim();
  const capped = oneLine.length > 300 ? `${oneLine.slice(0, 300)}…` : oneLine;
  return `- \`${capped.replace(/`/g, "'")}\``;
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

export interface GenerateProjectInput {
  manifest: Manifest;
  exportConfig: ExportConfig;
  /**
   * Per-template wizard answers. When present (and a materializer is wired),
   * the selected add-on templates are materialized and merged into the
   * generated project (template-overrides-core).
   */
  addOnsAnswers?: AddOnAnswers;
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
    private readonly materializer?: AddOnMaterializerPort,
  ) {}

  async execute(
    input: GenerateProjectInput,
  ): Promise<Result<GenerateProjectOutput, Error>> {
    const tempDir = path.join(
      "/tmp",
      `hexagen-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    );

    try {
      const genResult = await this.generator.generateAt(
        tempDir,
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

      const addOnsAnswers = input.addOnsAnswers;
      if (
        this.materializer &&
        addOnsAnswers &&
        Object.keys(addOnsAnswers).length > 0
      ) {
        const materialized = await this.materializer.materialize(addOnsAnswers);
        warnings.push(...materialized.warnings);
        errors = materialized.errors;

        // A bad selection comes back as `errors` with no files — skip the merge
        // and let the core project still ship, errors surfaced (not thrown).
        if (materialized.files.size > 0) {
          await this.mergeAddOnFilesIntoTempDir(
            tempDir,
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
          await this.mergeAddOnFilesIntoTempDir(
            tempDir,
            project,
            notice,
            warnings,
          );
          project = project.withAdditionalFiles(notice);
        }
      }

      const exportResult = await this.exporter.export(
        tempDir,
        input.exportConfig,
      );

      if (!exportResult.success) {
        return {
          success: false,
          error: new Error(exportResult.error ?? "Export failed"),
        };
      }

      let zipBuffer: Buffer | undefined;
      if (input.exportConfig.destination === "archive") {
        try {
          const zipPath = path.join(tempDir, "project.zip");
          const zipContent = await fs.readFile(zipPath);
          zipBuffer = zipContent;
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
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
    }
  }

  /**
   * Write each materialized add-on file into the temp dir (so the ZIP / GitHub
   * export captures it) with template-overrides-core precedence, recording a
   * warning for every generated file an add-on replaces. Runs **after**
   * `generateAt` and **before** `export`. The matching merge into the in-memory
   * `project.files` (for the code view) is done by the caller via
   * `Project.withAdditionalFiles`.
   */
  private async mergeAddOnFilesIntoTempDir(
    tempDir: string,
    project: Project,
    files: ReadonlyMap<string, string>,
    warnings: string[],
  ): Promise<void> {
    // Resolve the real project root once (`generateAt` created tempDir; the
    // mkdir is defensive and makes realpath safe if a caller skipped it).
    await fs.mkdir(tempDir, { recursive: true });
    const realRoot = await fs.realpath(tempDir);

    for (const [rel, content] of files) {
      const dest = path.join(tempDir, rel);
      const within = path.relative(tempDir, dest);
      if (
        within === ".." ||
        within.startsWith(".." + path.sep) ||
        path.isAbsolute(within)
      ) {
        // Lexical guard: reject `..`/absolute keys. The emitter already enforces
        // this, so reaching here is a should-never-happen bug, not user input.
        throw new Error(`Add-on file path escapes project root: ${rel}`);
      }
      if (project.files.has(rel)) {
        warnings.push(`Add-on template overrides generated file: ${rel}`);
      }
      await fs.mkdir(path.dirname(dest), { recursive: true });

      // Symlink guard: a lexical check can't see symlinks. Verify the real
      // parent stays under the project root, and never write through a
      // symlinked target — so a symlink under tempDir can't redirect the write.
      const realParent = await fs.realpath(path.dirname(dest));
      if (
        realParent !== realRoot &&
        !realParent.startsWith(realRoot + path.sep)
      ) {
        throw new Error(
          `Add-on file path escapes project root via symlink: ${rel}`,
        );
      }
      const existing = await fs.lstat(dest).catch(() => null);
      if (existing?.isSymbolicLink()) {
        throw new Error(`Add-on file target is a symlink: ${rel}`);
      }

      await fs.writeFile(dest, content, "utf-8");
    }
  }
}
