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
import {
  conflictFilePath,
  isOutputEnabled,
  outputPath,
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

    const resolvedRoot = path.resolve(projectRoot);
    for (const out of manifest.outputs) {
      if (!isOutputEnabled(out, answers)) continue;
      const outputRelPath = outputPath(out);
      const destFile = path.resolve(projectRoot, outputRelPath);
      if (
        !destFile.startsWith(resolvedRoot + path.sep) &&
        destFile !== resolvedRoot
      ) {
        throw new Error(
          `Output path '${outputRelPath}' escapes the project root`,
        );
      }
      const sourceFile = path.join(templateFilesDir, outputRelPath);

      let templateContent: string;
      // Permission bits of the template source, preserved on emit so executable
      // scripts (e.g. *.sh with a shebang) stay runnable. Defaults to 0o644.
      let sourceMode = 0o644;
      try {
        const raw = await fs.readFile(sourceFile, "utf-8");
        sourceMode = (await fs.stat(sourceFile)).mode & 0o777;
        const { output, warnings: interpWarnings } = interpolate(raw, answers);
        templateContent = output;
        for (const key of interpWarnings) {
          warnings.push(
            `⚠️  Unresolved template variable '{${key}}' in ${outputRelPath}`,
          );
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          // Template source file not yet implemented — planned output, skip silently
          continue;
        }
        throw new Error(
          `Failed to read template source ${sourceFile}: ${(err as Error).message}`,
        );
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

        // The file is safe to overwrite if its current content matches a hash
        // any installed template recorded at this path — covering both
        // idempotent re-emits by the same template and intentional cross-template
        // overrides (e.g. an auth provider replacing auth-mock's stub). If no
        // recorded hash matches, the user has modified the file — emit a conflict
        // copy instead.
        // The config is loaded from disk without schema validation, so a
        // malformed record (missing/non-array generatedFiles, or templates not
        // an object) must not crash the scan — treat anything unexpected as
        // "no matching record" rather than throwing.
        const wasGeneratedByHexagen =
          typeof config.templates === "object" &&
          config.templates !== null &&
          Object.values(config.templates).some(
            (record) =>
              Array.isArray(record?.generatedFiles) &&
              record.generatedFiles.some(
                (f) =>
                  f.path === outputRelPath && f.contentHash === existingHash,
              ),
          );
        const isAlreadyIdentical = existingHash === templateHash;

        if (!isAlreadyIdentical && !wasGeneratedByHexagen) {
          // User has modified this file — emit conflict copy instead
          const conflictDest = conflictFilePath(destFile);
          await atomicWrite(conflictDest, templateContent, sourceMode);
          const rel = path.relative(projectRoot, conflictDest);
          warnings.push(
            `⚠️  Conflict: ${outputRelPath} has local changes.\n` +
              `   New version written to ${rel}\n` +
              `   Review and merge manually, then delete the conflict file.`,
          );
          continue;
        }
      }

      await atomicWrite(destFile, templateContent, sourceMode);
      generatedFiles.push({ path: outputRelPath, contentHash: templateHash });
    }

    return { warnings, generatedFiles };
  }
}

async function atomicWrite(
  filePath: string,
  content: string,
  mode?: number,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${Date.now()}`;
  try {
    await fs.writeFile(tmp, content, "utf-8");
    // Restore only the source's executable bits (masked by umask), keeping the
    // read/write bits as writeFile created them. This preserves script
    // executability without widening permissions beyond what the umask allows.
    if (mode !== undefined && (mode & 0o111) !== 0) {
      const created = (await fs.stat(tmp)).mode & 0o777;
      const execBits = mode & 0o111 & ~process.umask();
      await fs.chmod(tmp, created | execBits);
    }
    await fs.rename(tmp, filePath);
  } catch (err) {
    // Don't leave a stale temp file behind if any step failed.
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}
