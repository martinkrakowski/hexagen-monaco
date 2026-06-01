import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Manifest } from "./types/manifest.js";
import { ok, err, type Result } from "./domain/result.js";
import { mergeSplitManifest } from "./loaders/index.js";

export type { Result };

const execAsync = promisify(exec);

export async function loadManifest(
  workspaceRoot: string,
): Promise<Result<Manifest, Error>> {
  try {
    const manifestPath = path.join(
      workspaceRoot,
      ".architecture/manifest.yaml",
    );
    const manifest = (await mergeSplitManifest(
      workspaceRoot,
      manifestPath,
    )) as Manifest;
    return ok(manifest);
  } catch (errObj) {
    if (
      errObj instanceof Error &&
      "code" in errObj &&
      errObj.code === "ENOENT"
    ) {
      return err(new Error(".architecture/manifest.yaml not found"));
    }

    return err(errObj instanceof Error ? errObj : new Error(String(errObj)));
  }
}

export async function validateManifest(
  workspaceRoot: string,
): Promise<Result<{ valid: boolean; errors: string[] }, Error>> {
  try {
    // Invoke the installed arch-linter bin (scope-agnostic name) rather than
    // `yarn workspace …`, which only resolves inside this monorepo. In a
    // generated project the bin comes from the @hexagen-monaco/arch-linter
    // devDependency. It walks up from cwd to find .architecture/manifest.yaml.
    const { stderr } = await execAsync("node_modules/.bin/hexagen-lint", {
      cwd: workspaceRoot,
      timeout: 30_000,
    });

    void stderr;
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
