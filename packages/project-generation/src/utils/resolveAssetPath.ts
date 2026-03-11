import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Returns the absolute path to the workflow template file regardless of whether the code is executed
 * from the source (`src/`) or the compiled output (`dist/`).
 */
export function getWorkflowTemplatePath(): string {
  // __dirname points to the directory of this file at runtime.
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  // When compiled, the file lives under `dist/...`; otherwise under `src/...`.
  // Resolve relative to this helper file. Assets are located one level up in the same package.
  const relative = "../assets/workflow-template.yml";
  return path.resolve(currentDir, relative);
}
