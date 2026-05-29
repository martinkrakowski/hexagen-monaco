import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import type {
  FileEmitterPort,
  EmitResult,
} from "../application/ports/file-emitter.port.js";
import type {
  TemplateManifest,
  TemplateConfig,
  AnswerMap,
  GeneratedFileRecord,
} from "../domain/index.js";

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export class FileSystemFileEmitter implements FileEmitterPort {
  private readonly templatesDir: string;

  constructor(templatesDir?: string) {
    this.templatesDir = templatesDir ?? path.join(PACKAGE_ROOT, "templates");
  }

  async emit(
    manifest: TemplateManifest,
    answers: AnswerMap,
    projectRoot: string,
    config: TemplateConfig,
  ): Promise<EmitResult> {
    const warnings: string[] = [];
    const generatedFiles: GeneratedFileRecord[] = [];
    const templateFilesDir = path.join(this.templatesDir, manifest.id, "files");

    for (const outputRelPath of manifest.outputs) {
      const sourceFile = path.join(templateFilesDir, outputRelPath);
      const destFile = path.join(projectRoot, outputRelPath);

      let templateContent: string;
      try {
        const raw = await fs.readFile(sourceFile, "utf-8");
        templateContent = this.interpolate(raw, answers);
      } catch {
        // Template has no file content yet (planned but not implemented) — skip silently
        continue;
      }

      const templateHash = sha256(templateContent);

      // Detect conflict: file exists and has been user-modified
      let existingContent: string | null = null;
      try {
        existingContent = await fs.readFile(destFile, "utf-8");
      } catch {
        // File doesn't exist — clean write
      }

      if (existingContent !== null) {
        const existingHash = sha256(existingContent);
        const previousRecord = config.templates[manifest.id];
        const previousEntry = previousRecord?.generatedFiles.find(
          (f) => f.path === outputRelPath,
        );

        const wasGeneratedByUs = !!previousEntry;
        const isUnmodified =
          wasGeneratedByUs && previousEntry.contentHash === existingHash;
        const isAlreadyIdentical = existingHash === templateHash;

        if (isAlreadyIdentical || isUnmodified) {
          // Safe overwrite — idempotent
        } else {
          // User has modified this file — emit conflict copy instead
          const conflictPath = destFile + ".hexagen-update.ts";
          await atomicWrite(conflictPath, templateContent);
          const rel = path.relative(projectRoot, conflictPath);
          warnings.push(
            `⚠️  Conflict: ${outputRelPath} has local changes.\n` +
              `   New version written to ${rel}\n` +
              `   Review and merge manually, then delete the .hexagen-update.ts file.`,
          );
          continue;
        }
      }

      await atomicWrite(destFile, templateContent);
      generatedFiles.push({ path: outputRelPath, contentHash: templateHash });
    }

    return { warnings, generatedFiles };
  }

  /** Minimal {variable} interpolation — mirrors sync package template-engine.ts */
  private interpolate(template: string, vars: AnswerMap): string {
    return template.replace(
      /\{\{|\}\}|\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g,
      (match, key?: string) => {
        if (key === undefined) return match === "{{" ? "{" : "}";
        const value = vars[key];
        return value !== undefined && value !== null ? String(value) : match;
      },
    );
  }
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${Date.now()}`;
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, filePath);
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}
