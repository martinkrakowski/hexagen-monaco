import path from "node:path";
import fs from "node:fs/promises";
import yaml from "js-yaml";
import { isIndexManifest } from "@hexagen/project-configuration";
import { mergeSplitManifest } from "@hexagen/project-configuration/server";

export interface ManifestDocument {
  bounded_contexts?: Array<{
    name: string;
    type?: "core" | "supporting" | "generic" | "shared-kernel";
    depends_on?: string[];
    [key: string]: unknown;
  }>;
  [key: string]: unknown;
}

export async function readManifestDocument(
  workspaceRoot: string,
): Promise<ManifestDocument> {
  const manifestPath = path.join(workspaceRoot, ".architecture/manifest.yaml");
  const manifest = await mergeSplitManifest(workspaceRoot, manifestPath);
  return manifest as unknown as ManifestDocument;
}

export async function writeManifestDocument(
  workspaceRoot: string,
  manifest: ManifestDocument,
): Promise<void> {
  const manifestPath = path.join(workspaceRoot, ".architecture/manifest.yaml");
  const raw = await fs.readFile(manifestPath, "utf-8");
  const parsed = yaml.load(raw);

  if (isIndexManifest(parsed)) {
    throw new Error(
      "Cannot write to a split manifest via single-file write. " +
        "Use the split-aware CLI to modify individual context files.",
    );
  }

  const content = yaml.dump(manifest, {
    indent: 2,
    sortKeys: false,
    lineWidth: 0,
  });
  await fs.writeFile(manifestPath, content, "utf-8");
}
