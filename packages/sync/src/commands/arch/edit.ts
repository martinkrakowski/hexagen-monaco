import { Command } from "commander";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import type { Manifest } from "@hexagen/sync";
import { getProjectRoot, findProjectRoot } from "../shared/project-root.js";
import { yamlService } from "../shared/yaml-service.js";
import { spinner } from "../shared/spinner.js";
import { promptService } from "../shared/prompt-service.js";

export interface EditOptions {
  editor?: string;
  validateOnly?: boolean;
  dryRun?: boolean;
}

function getManifestPath(cwd: string): string {
  return join(cwd, ".architecture", "manifest.yaml");
}

function loadManifest(path: string): Manifest {
  const result = yamlService.loadManifest(path);
  if (!result.success) {
    throw result.error;
  }
  return result.value;
}

function detectEditor(): { editor: string; args: string[] } {
  const editor = process.env.VISUAL || process.env.EDITOR;

  if (editor) {
    return { editor, args: [] };
  }

  return { editor: "nano", args: [] };
}

function validateManifestStructure(manifest: Manifest): string[] {
  const errors: string[] = [];

  if (!manifest.system) {
    errors.push("Missing required field: system");
  }

  if (!manifest.architecture) {
    errors.push("Missing required field: architecture");
  }

  if (!manifest.bounded_contexts || !Array.isArray(manifest.bounded_contexts)) {
    errors.push("Missing or invalid field: bounded_contexts (must be array)");
  } else {
    for (const ctx of manifest.bounded_contexts) {
      if (!ctx.name) {
        errors.push("Context missing required field: name");
      } else if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(ctx.name)) {
        errors.push(`Invalid context name '${ctx.name}': must be snake_case`);
      }
    }
  }

  return errors;
}

async function runEditor(editor: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(editor, args, {
      stdio: "inherit",
      env: process.env,
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Editor exited with code ${code}`));
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

export async function editCommand(options: EditOptions = {}): Promise<void> {
  const cwd = getProjectRoot();
  const manifestPath = getManifestPath(cwd);
  const { editor: editorName, args: editorArgs } = options.editor
    ? { editor: options.editor, args: [] }
    : detectEditor();

  if (!existsSync(manifestPath)) {
    console.error("❌ Manifest not found:", manifestPath);
    process.exit(1);
  }

  console.log("Loading manifest...");
  spinner.start("Loading manifest");

  let manifest: Manifest;
  try {
    manifest = loadManifest(manifestPath);
    spinner.succeed("Manifest loaded");
  } catch (err) {
    spinner.fail("Failed to load manifest");
    console.error("❌ Failed to load manifest:", (err as Error).message);
    process.exit(1);
  }

  if (options.validateOnly) {
    console.log("✅ YAML syntax valid\n");

    const errors = validateManifestStructure(manifest);
    if (errors.length > 0) {
      console.log("⚠️ Validation errors:");
      for (const error of errors) {
        console.log(`  - ${error}`);
      }
      process.exit(1);
    }

    console.log("✅ Manifest structure valid\n");
    console.log(
      `Bounded Contexts (${manifest.bounded_contexts?.length || 0}):`,
    );
    for (const ctx of manifest.bounded_contexts || []) {
      console.log(`  • ${ctx.name} (${ctx.type || "core"})`);
    }
    return;
  }

  if (!promptService.canPrompt()) {
    console.error("❌ No terminal detected.");
    console.error("   This command requires an interactive terminal.");
    console.error(
      "   Use --validate-only to validate without editing, or set $EDITOR.",
    );
    process.exit(1);
  }

  const tempPath = join(tmpdir(), `manifest-${Date.now()}.yaml`);

  try {
    const originalContent = yamlService.serialize(manifest);
    writeFileSync(tempPath, originalContent, "utf-8");

    console.log(`✅ Opening ${editorName}...`);

    try {
      const args =
        editorArgs.length > 0 ? [tempPath, ...editorArgs] : [tempPath];
      await runEditor(editorName, args);
    } catch (err) {
      console.error("❌ Failed to launch editor:", (err as Error).message);
      process.exit(1);
    }

    if (options.dryRun) {
      console.log("\n⚠️  DRY-RUN MODE: No changes will be written\n");

      let editedContent: string;
      let editedManifest: Manifest;
      try {
        editedContent = readFileSync(tempPath, "utf-8");
        const parseResult = yamlService.parse(editedContent);
        if (!parseResult.success) {
          throw parseResult.error;
        }
        editedManifest = parseResult.value;
      } catch (err) {
        console.error(
          "❌ Failed to parse edited file:",
          (err as Error).message,
        );
        process.exit(1);
      }

      const errors = validateManifestStructure(editedManifest);
      if (errors.length > 0) {
        console.log("⚠️ Validation errors in edited file:");
        for (const error of errors) {
          console.log(`  - ${error}`);
        }
        process.exit(1);
      }

      console.log("✅ YAML syntax valid");
      console.log("✅ Manifest structure valid");

      if (editedContent.trim() === originalContent.trim()) {
        console.log("✅ No changes detected.");
      } else {
        console.log("✅ Changes would be written.");
      }
      unlinkSync(tempPath);
      return;
    }

    console.log("✅ YAML syntax valid");

    let editedManifest: Manifest;
    let editedContent: string;
    try {
      editedContent = readFileSync(tempPath, "utf-8");
      const parseResult = yamlService.parse(editedContent);
      if (!parseResult.success) {
        throw parseResult.error;
      }
      editedManifest = parseResult.value;
    } catch (err) {
      console.error("❌ Failed to parse edited file:", (err as Error).message);
      process.exit(1);
    }

    const errors = validateManifestStructure(editedManifest);
    if (errors.length > 0) {
      console.log("⚠️ Validation errors:");
      for (const error of errors) {
        console.log(`  - ${error}`);
      }
      console.log("\n❌ Fix the errors above and try again.");
      unlinkSync(tempPath);
      process.exit(1);
    }

    console.log("✅ Manifest structure valid");

    // Check if content changed
    if (editedContent.trim() === originalContent.trim()) {
      console.log("✅ No changes detected.");
      unlinkSync(tempPath);
      return;
    }

    console.log("✅ Writing manifest...");

    writeFileSync(manifestPath, editedContent, "utf-8");

    console.log("✅ Success! Manifest updated.");

    unlinkSync(tempPath);
  } catch (err) {
    try {
      if (existsSync(tempPath)) unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    console.error("❌ Error:", (err as Error).message);
    process.exit(1);
  }
}

export const editCommander = new Command("edit")
  .description("Edit manifest.yaml with your preferred editor")
  .option("-e, --editor <name>", "Editor to use (default: nano or $EDITOR)")
  .option("--validate-only", "Validate manifest without editing")
  .option("--dry-run", "Preview changes without saving")
  .action(async (options) => {
    await editCommand(options);
  });
