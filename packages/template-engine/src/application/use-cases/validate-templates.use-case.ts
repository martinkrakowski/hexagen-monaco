import fs from "node:fs/promises";
import path from "node:path";
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
      const answers = config.templates[id].answers;

      const missingFiles: string[] = [];
      for (const output of manifest.outputs) {
        if (!isOutputEnabled(output, answers)) continue;
        const rel = outputPath(output);
        const abs = path.join(projectRoot, rel);
        try {
          await fs.access(abs);
        } catch {
          missingFiles.push(rel);
        }
      }

      const missingEnvVars: string[] = [];
      for (const envVar of manifest.envVars) {
        if (process.env[envVar] === undefined) {
          missingEnvVars.push(envVar);
        }
      }

      // Scan all declared outputs — not just record.generatedFiles — because
      // the emitter does not add an entry to generatedFiles when a conflict occurs.
      const conflictFiles: string[] = [];
      for (const output of manifest.outputs) {
        if (!isOutputEnabled(output, answers)) continue;
        const absConflict = conflictFilePath(
          path.join(projectRoot, outputPath(output)),
        );
        try {
          await fs.access(absConflict);
          conflictFiles.push(path.relative(projectRoot, absConflict));
        } catch {
          // no conflict file — good
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
