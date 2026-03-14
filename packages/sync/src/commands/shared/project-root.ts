import { existsSync } from "fs";
import { join, dirname } from "path";

export function findProjectRoot(from: string): string | null {
  let current = from;
  while (true) {
    const manifestPath = join(current, ".architecture", "manifest.yaml");
    if (existsSync(manifestPath)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export function getProjectRoot(): string {
  const root = findProjectRoot(process.cwd());
  if (!root) {
    console.error(
      "❌ No project root found. Is .architecture/manifest.yaml present?",
    );
    process.exit(1);
  }
  return root;
}
