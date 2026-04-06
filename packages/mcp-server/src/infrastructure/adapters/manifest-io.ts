import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

export interface ManifestDocument {
  bounded_contexts?: Array<{
    name: string;
    type?: "core" | "supporting" | "driver" | "shared-kernel";
    depends_on?: string[];
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export async function readManifestDocument(
  workspaceRoot: string,
): Promise<ManifestDocument> {
  const manifestPath = path.join(workspaceRoot, ".architecture/manifest.yaml");
  const content = await fs.readFile(manifestPath, "utf-8");

  if (!content.trim()) {
    throw new Error("manifest.yaml is empty");
  }

  const parsed = yaml.load(content);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("manifest.yaml does not contain a YAML object");
  }

  return parsed as ManifestDocument;
}

export async function writeManifestDocument(
  workspaceRoot: string,
  manifest: ManifestDocument,
): Promise<void> {
  const manifestPath = path.join(workspaceRoot, ".architecture/manifest.yaml");
  const content = yaml.dump(manifest, { indent: 2 });
  await fs.writeFile(manifestPath, content, "utf-8");
}
