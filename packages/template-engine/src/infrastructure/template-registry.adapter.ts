import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { TemplateRegistryPort } from "../application/ports/template-registry.port.js";
import type { TemplateManifest } from "../domain/index.js";
import { validateManifest } from "../domain/index.js";

const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export class FileSystemTemplateRegistry implements TemplateRegistryPort {
  private readonly templatesDir: string;
  private cache: TemplateManifest[] | null = null;

  constructor(templatesDir?: string) {
    this.templatesDir = templatesDir ?? path.join(PACKAGE_ROOT, "templates");
  }

  async loadAll(): Promise<TemplateManifest[]> {
    if (this.cache) return this.cache;

    let entries: string[];
    try {
      entries = await fs.readdir(this.templatesDir);
    } catch {
      return [];
    }

    const manifests: TemplateManifest[] = [];
    for (const entry of entries) {
      const manifestPath = path.join(this.templatesDir, entry, "manifest.json");
      const manifest = await this.readManifest(manifestPath);
      if (manifest) manifests.push(manifest);
    }

    this.cache = manifests;
    return manifests;
  }

  async loadOne(id: string): Promise<TemplateManifest | null> {
    const manifestPath = path.join(this.templatesDir, id, "manifest.json");
    return this.readManifest(manifestPath);
  }

  private async readManifest(
    manifestPath: string,
  ): Promise<TemplateManifest | null> {
    let raw: string;
    try {
      raw = await fs.readFile(manifestPath, "utf-8");
    } catch {
      return null; // no manifest.json here — not a template dir, skip silently
    }
    try {
      return validateManifest(JSON.parse(raw));
    } catch (err) {
      // A present-but-invalid manifest is a real error, not an absent template.
      // Surface it with file context instead of a silent null — otherwise it
      // resurfaces downstream as a confusing MissingTemplateError in dependency
      // resolution. Still returns null so one bad manifest doesn't abort listing
      // the rest.
      console.warn(
        `[template-registry] skipping invalid manifest ${manifestPath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }
}
