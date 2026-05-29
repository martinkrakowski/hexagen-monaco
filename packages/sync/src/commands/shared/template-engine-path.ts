import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolves the templates directory for @hexagen/template-engine.
 *
 * The templates/ directory is copied into dist/ alongside cli.js at build time
 * (see tsup.config.ts onSuccess). This ensures the path works both during monorepo
 * development (packages/sync/dist/templates/) and in a staged/published package
 * (publish/dist/templates/).
 *
 * Override: HEXAGEN_TEMPLATES_DIR env var (for CI, custom installs, etc.)
 */
export function resolveTemplatesDir(): string {
  if (process.env.HEXAGEN_TEMPLATES_DIR) {
    return process.env.HEXAGEN_TEMPLATES_DIR;
  }
  const cliDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(cliDir, "templates");
}
