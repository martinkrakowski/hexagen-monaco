import { Command } from "commander";
import {
  loadManifest,
  addContextToManifest,
  saveManifest,
} from "./persistence.js";
import { runContextWizard } from "./wizard.js";
import { getProjectRoot } from "../../shared/project-root.js";

export const contextCommander = new Command("context").description(
  "Add a new bounded context interactively",
);

export async function contextCommand(): Promise<void> {
  const cwd = getProjectRoot();

  // Load current manifest state
  const manifestResult = loadManifest(cwd);

  if (!manifestResult.success) {
    console.error("⚠️  Failed to read manifest:", manifestResult.error.message);
    process.exit(1);
  }

  const manifest = manifestResult.data;

  // Run interactive wizard
  const contextDef = await runContextWizard(manifest);

  if (!contextDef) {
    console.info("👋 Wizard cancelled by user.");
    return;
  }

  // Add context to manifest
  const updatedManifest = addContextToManifest(
    manifest,
    contextDef.name,
    contextDef.type as "core" | "supporting" | "shared-kernel" | "driver",
    contextDef.description,
  );

  // Save atomically
  const saveResult = saveManifest(cwd, updatedManifest);

  if (!saveResult.success) {
    console.error("⚠️  Failed to save manifest:", saveResult.error?.message);
    process.exit(1);
  }

  console.info(
    `\n✅ Context '${contextDef.name}' added successfully to manifest.yaml`,
  );
}

contextCommander.action(contextCommand);
