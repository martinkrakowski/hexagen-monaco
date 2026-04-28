import { exec } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type { Manifest, ManifestDiff } from "@hexagen/project-configuration";
import { computeDiff } from "@hexagen/project-configuration";
import type { Result } from "@hexagen/shared";
import { ok, err } from "@hexagen/shared";
import type { ManifestDiffPort } from "../../application/ports/out/manifest-diff.port.js";

const execAsync = promisify(exec);

export class ManifestDiffAdapter implements ManifestDiffPort {
  constructor(private readonly workspaceRoot: string) {}

  async diffAgainstGitHead(): Promise<Result<ManifestDiff>> {
    try {
      const manifestPath = path.join(
        this.workspaceRoot,
        ".architecture/manifest.yaml",
      );
      const currentContent = await readFile(manifestPath, "utf-8");
      const current = yaml.load(currentContent) as Manifest;

      const { stdout: previousContent } = await execAsync(
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
      const currentContent = await readFile(manifestPath, "utf-8");
      const current = yaml.load(currentContent) as Manifest;

      const comparisonContent = await readFile(filePath, "utf-8");
      const previous = yaml.load(comparisonContent) as Manifest;

      const diff = computeDiff(current, previous);
      return ok(diff);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
