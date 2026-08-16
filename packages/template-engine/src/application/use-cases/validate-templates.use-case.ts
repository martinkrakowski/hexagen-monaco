import type { EnvironmentReaderPort } from "../ports/environment-reader.port.js";
import type { ProjectFilePresencePort } from "../ports/project-file-presence.port.js";
import type { TemplateConfigStorePort } from "../ports/template-config-store.port.js";
import type { TemplateRegistryPort } from "../ports/template-registry.port.js";
import {
  conflictFilePath,
  isOutputEnabled,
  outputPath,
} from "../../domain/index.js";

export interface ValidationResult {
  templateId: string;
  missingFiles: string[];
  missingEnvVars: string[];
  conflictFiles: string[];
  passed: boolean;
}

export interface ValidateTemplatesOutput {
  results: ValidationResult[];
  totalWarnings: number;
  totalErrors: number;
}

export class ValidateTemplatesUseCase {
  constructor(
    private readonly registry: TemplateRegistryPort,
    private readonly configStore: TemplateConfigStorePort,
    private readonly files: ProjectFilePresencePort,
    private readonly environment: EnvironmentReaderPort,
  ) {}

  async execute(projectRoot: string): Promise<ValidateTemplatesOutput> {
    const config = await this.configStore.load(projectRoot);
    const installedIds = Object.keys(config.templates);

    if (installedIds.length === 0) {
      return { results: [], totalWarnings: 0, totalErrors: 0 };
    }

    const allManifests = await this.registry.loadAll();
    const manifestMap = new Map(allManifests.map((m) => [m.id, m]));

    const results: ValidationResult[] = [];
    let totalWarnings = 0;
    let totalErrors = 0;

    for (const id of installedIds) {
      const manifest = manifestMap.get(id);
      if (!manifest) {
        results.push({
          templateId: id,
          missingFiles: [],
          missingEnvVars: [],
          conflictFiles: [
            `Template '${id}' is installed but not found in registry`,
          ],
          passed: false,
        });
        totalErrors++;
        continue;
      }

      // Gated outputs are evaluated against the answers recorded at install time,
      // so files that were intentionally not emitted aren't reported as missing.
      // The config is loaded from disk without schema validation, so coerce a
      // missing/corrupt `answers` to an empty map rather than risk a crash.
      const record = config.templates[id];
      const answers =
        record && typeof record.answers === "object" && record.answers !== null
          ? record.answers
          : {};

      const missingFiles: string[] = [];
      for (const output of manifest.outputs) {
        if (!isOutputEnabled(output, answers)) continue;
        const rel = outputPath(output);
        if (!(await this.files.exists(projectRoot, rel))) {
          missingFiles.push(rel);
        }
      }

      const missingEnvVars: string[] = [];
      for (const envVar of manifest.envVars) {
        if (this.environment.get(envVar) === undefined) {
          missingEnvVars.push(envVar);
        }
      }

      // Scan all declared outputs — not just record.generatedFiles — because
      // the emitter does not add an entry to generatedFiles when a conflict occurs.
      //
      // `conflictFilePath` only rewrites the basename's extension, so deriving
      // it from the project-relative output path yields the same string the
      // previous `relative(root, conflictFilePath(join(root, rel)))` round-trip
      // produced, without needing node:path here. Manifest outputs are plain
      // normalized relative paths (a `./`-prefixed or absolute output would
      // now be echoed back verbatim instead of normalized — it was never
      // valid, and `isContainedRelativePath` is the guard for that).
      const conflictFiles: string[] = [];
      for (const output of manifest.outputs) {
        if (!isOutputEnabled(output, answers)) continue;
        const relConflict = conflictFilePath(outputPath(output));
        if (await this.files.exists(projectRoot, relConflict)) {
          conflictFiles.push(relConflict);
        }
      }

      const passed = missingFiles.length === 0 && conflictFiles.length === 0;
      if (!passed) totalErrors += missingFiles.length + conflictFiles.length;
      totalWarnings += missingEnvVars.length;

      results.push({
        templateId: id,
        missingFiles,
        missingEnvVars,
        conflictFiles,
        passed,
      });
    }

    return { results, totalWarnings, totalErrors };
  }
}
