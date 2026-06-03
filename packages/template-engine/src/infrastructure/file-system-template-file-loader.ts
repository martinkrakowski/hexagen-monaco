import fs from "node:fs/promises";
import path from "node:path";
import { isContainedRelativePath } from "../domain/index.js";
import type { TemplateFileLoader } from "./in-memory-file-emitter.adapter.js";

/**
 * A TemplateFileLoader backed by the on-disk `templates/<id>/files/<relPath>`
 * tree. Used by tests and any Node context with filesystem access; the
 * web/serverless path uses a generated-module loader instead (no runtime fs).
 */
export function createFileSystemTemplateFileLoader(
  templatesDir: string,
): TemplateFileLoader {
  return async (templateId, relPath) => {
    // Reject a relPath that would escape templates/<id>/files (../ or absolute)
    // before touching the filesystem.
    if (!isContainedRelativePath(relPath)) {
      throw new Error(
        `Template '${templateId}' source path '${relPath}' escapes the template directory`,
      );
    }
    const file = path.join(templatesDir, templateId, "files", relPath);
    try {
      return await fs.readFile(file, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  };
}
