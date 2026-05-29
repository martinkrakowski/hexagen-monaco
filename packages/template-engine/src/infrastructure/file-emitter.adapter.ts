import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { interpolate } from "@hexagen/shared";
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
import { conflictFilePath } from "../domain/index.js";

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
        const { output, warnings: interpWarnings } = interpolate(raw, answers);
        templateContent = output;
        for (const key of interpWarnings) {
          warnings.push(
            `⚠️  Unresolved template variable '{${key}}' in ${outputRelPath}`,
          );
        }
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

        if (!isAlreadyIdentical && !isUnmodified) {
          // User has modified this file — emit conflict copy instead
          const conflictDest = conflictFilePath(destFile);
          await atomicWrite(conflictDest, templateContent);
          const rel = path.relative(projectRoot, conflictDest);
          warnings.push(
            `⚠️  Conflict: ${outputRelPath} has local changes.\n` +
              `   New version written to ${rel}\n` +
              `   Review and merge manually, then delete the conflict file.`,
          );
          continue;
        }
      }

      await atomicWrite(destFile, templateContent);
      generatedFiles.push({ path: outputRelPath, contentHash: templateHash });
    }

    return { warnings, generatedFiles };
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
