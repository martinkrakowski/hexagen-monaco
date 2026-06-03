import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateManifest } from "../domain/index.js";
import type { TemplateManifest } from "../domain/index.js";

const DEFAULT_TEMPLATES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "templates",
);

export interface TemplateBundle {
  manifests: TemplateManifest[];
  /** "<templateId>/<pathRelativeToFilesDir>" → raw file content. */
  files: Record<string, string>;
}

async function collectFiles(
  dir: string,
  filesDir: string,
  id: string,
  out: Record<string, string>,
): Promise<void> {
  const entries = await fs
    .readdir(dir, { withFileTypes: true })
    .catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return []; // a template may have no files/ dir
      throw err;
    });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await collectFiles(full, filesDir, id, out);
    } else {
      const rel = path.relative(filesDir, full).split(path.sep).join("/");
      out[`${id}/${rel}`] = await fs.readFile(full, "utf-8");
    }
  }
}

/**
 * Read every template's manifest + `files/**` from disk into an in-memory
 * bundle, with deterministic key ordering. Used at generation time
 * (scripts/generate-template-bundle.ts) and by the parity test — NOT at runtime
 * (the web reads the generated module, which carries no filesystem dependency).
 */
export async function buildTemplateBundle(
  templatesDir: string = DEFAULT_TEMPLATES_DIR,
): Promise<TemplateBundle> {
  const dirs = await fs.readdir(templatesDir, { withFileTypes: true });
  const ids = dirs
    .filter((e) => e.isDirectory() && !e.name.startsWith("__"))
    .map((e) => e.name)
    .sort();

  const manifests: TemplateManifest[] = [];
  const files: Record<string, string> = {};

  for (const id of ids) {
    let raw: string;
    try {
      raw = await fs.readFile(
        path.join(templatesDir, id, "manifest.json"),
        "utf-8",
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue; // not a template
      throw err;
    }
    manifests.push(validateManifest(JSON.parse(raw)));
    await collectFiles(
      path.join(templatesDir, id, "files"),
      path.join(templatesDir, id, "files"),
      id,
      files,
    );
  }

  // Code-unit comparison (not localeCompare, which depends on the runtime's
  // locale/ICU data) so the committed bundle's key order is reproducible across
  // machines — matches the `ids.sort()` above.
  const sortedFiles = Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return { manifests, files: sortedFiles };
}
