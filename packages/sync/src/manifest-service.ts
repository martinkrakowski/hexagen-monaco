import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { execSync } from "node:child_process";
import type { Manifest } from "./types/manifest.js";
import { ok, err, type Result } from "./domain/result.js";
import { ManifestSchema } from "@hexagen/shared";

export type { Result };

export async function loadManifest(
  workspaceRoot: string,
): Promise<Result<Manifest, Error>> {
  try {
    const manifestPath = path.join(
      workspaceRoot,
      ".architecture/manifest.yaml",
    );
    const content = await fs.readFile(manifestPath, "utf-8");

    if (!content.trim()) {
      return err(new Error("manifest.yaml is empty"));
    }

    const parsed = yaml.load(content) as Manifest;
    // Validate against Zod schema
    const validationResult = ManifestSchema.safeParse(parsed);
    if (!validationResult.success) {
      return err(
        new Error(
          `Manifest validation failed: ${validationResult.error.message}`,
        ),
      );
    }
    // Return validated manifest (cast to Manifest type since we know it's valid)
    return ok(parsed);
  } catch (errObj) {
    if (
      errObj instanceof Error &&
      "code" in errObj &&
      errObj.code === "ENOENT"
    ) {
      return err(new Error(".architecture/manifest.yaml not found"));
    }

    return err(errObj as Error);
  }
}

export async function validateManifest(
  workspaceRoot: string,
): Promise<Result<{ valid: boolean; errors: string[] }, Error>> {
  try {
    execSync("yarn workspace @hexagen/arch-linter lint:arch", {
      cwd: workspaceRoot,
      stdio: "pipe",
    });

    return ok({ valid: true, errors: [] });
  } catch (errObj) {
    const error = errObj as Error & { stderr?: string | Buffer };
    const message = error.stderr
      ? String(error.stderr)
      : error.message || "Unknown linter error";
    const errors = message
      .split("\n")
      .filter((line: string) => line.trim().length > 0);

    return ok({ valid: false, errors });
  }
}

export async function saveManifest(
  workspaceRoot: string,
  manifest: Manifest,
): Promise<Result<void, Error>> {
  try {
    const manifestPath = path.join(
      workspaceRoot,
      ".architecture/manifest.yaml",
    );
    const content = yaml.dump(manifest, { indent: 2 });

    await fs.writeFile(manifestPath, content, "utf-8");

    return ok(undefined);
  } catch (errObj) {
    return err(errObj as Error);
  }
}
