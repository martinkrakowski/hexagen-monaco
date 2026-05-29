import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolves the templates directory for @hexagen/template-engine.
 *
 * When the sync CLI is bundled by tsup (noExternal: @hexagen/**), all workspace
 * packages are inlined. import.meta.url inside inlined code points to the sync
 * bundle's URL, not the original package file. This utility uses the sync CLI
 * bundle's own URL to compute the correct monorepo-relative path.
 *
 * Layout:   packages/sync/dist/cli.js
 *               ../../            → packages/
 *               template-engine/templates
 *
 * Override: HEXAGEN_TEMPLATES_DIR env var (for CI, custom installs, etc.)
 */
export function resolveTemplatesDir(): string {
  if (process.env.HEXAGEN_TEMPLATES_DIR) {
    return process.env.HEXAGEN_TEMPLATES_DIR;
  }
  const cliDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(cliDir, "..", "..", "template-engine", "templates");
}
