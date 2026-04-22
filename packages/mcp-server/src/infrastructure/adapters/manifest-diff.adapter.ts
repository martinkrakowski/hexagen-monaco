import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import type { Manifest, ManifestDiff, Result } from "@hexagen/shared";
import { computeDiff, ok, err } from "@hexagen/shared";
import type { ManifestDiffPort } from "../../application/ports/out/manifest-diff.port.js";

export class ManifestDiffAdapter implements ManifestDiffPort {
  constructor(private readonly workspaceRoot: string) {}

  async diffAgainstGitHead(): Promise<Result<ManifestDiff>> {
    try {
      const manifestPath = path.join(
        this.workspaceRoot,
        ".architecture/manifest.yaml",
      );
      const currentContent = readFileSync(manifestPath, "utf-8");
      const current = yaml.load(currentContent) as Manifest;

      const previousContent = execSync(
        "git show HEAD:.architecture/manifest.yaml",
        { cwd: this.workspaceRoot, encoding: "utf-8" },
      );
      const previous = yaml.load(previousContent) as Manifest;

      const diff = computeDiff(current, previous);
      return ok(diff);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async diffAgainstFile(filePath: string): Promise<Result<ManifestDiff>> {
    try {
      const manifestPath = path.join(
        this.workspaceRoot,
        ".architecture/manifest.yaml",
      );
      const currentContent = readFileSync(manifestPath, "utf-8");
      const current = yaml.load(currentContent) as Manifest;

      const comparisonContent = readFileSync(filePath, "utf-8");
      const previous = yaml.load(comparisonContent) as Manifest;

      const diff = computeDiff(current, previous);
      return ok(diff);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
