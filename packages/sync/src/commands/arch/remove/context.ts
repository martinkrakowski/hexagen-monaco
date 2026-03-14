import { Command } from "commander";
import * as readline from "node:readline";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "fs";
import type { Manifest } from "@hexagen/sync";
import { generateManifestYaml } from "../port/persistence.js";
import { load } from "js-yaml";

export interface RemoveContextOptions {
  force?: boolean;
}

export const removeContextCommander = new Command("context")
  .description("Remove a bounded context from the manifest")
  .action(async (options: RemoveContextOptions) => {
    await removeContextCommand(options);
  });

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function getContextSelection(
  manifest: Manifest,
  rl: readline.Interface,
): Promise<string | null> {
  const contexts = manifest.bounded_contexts ?? [];

  if (contexts.length === 0) {
    console.info("⚠️  No bounded contexts found in manifest.");
    return null;
  }

  console.info("\n📋 Available bounded contexts:\n");
  contexts.forEach((ctx, index) => {
    console.info(`  ${index + 1}. ${ctx.name}`);
    if (ctx.type) {
      console.info(`      Type: ${ctx.type}`);
    }
  });

  const answer = await ask(rl, "\nSelect context number to remove: ");
  const numIndex = parseInt(answer, 10) - 1;

  if (isNaN(numIndex) || numIndex < 0 || numIndex >= contexts.length) {
    console.warn("⚠️  Invalid selection.");
    return null;
  }

  const selected = contexts[numIndex];
  console.info(`\n➡️  Selected: ${selected.name}`);

  return selected.name;
}

async function confirmRemoval(
  contextName: string,
  rl: readline.Interface,
): Promise<boolean> {
  const answer = await ask(
    rl,
    `\n⚠️  Are you sure you want to remove context '${contextName}'? This will also remove all its ports. (y/n): `,
  );

  return answer.toLowerCase() === "y";
}

function removeContextFromManifest(
  manifest: Manifest,
  contextName: string,
): Manifest {
  return {
    ...manifest,
    bounded_contexts:
      manifest.bounded_contexts?.filter((ctx) => ctx.name !== contextName) ??
      [],
  };
}

export async function removeContextCommand(
  options: RemoveContextOptions = {},
): Promise<void> {
  const cwd = process.cwd();
  const manifestPath = `${cwd}/.architecture/manifest.yaml`;
  // Get force from parent command hook or direct option
  const force =
    options.force ?? (removeContextCommander as any).forceOption ?? false;

  let manifest: Manifest;

  try {
    const content = readFileSync(manifestPath, "utf-8");
    const loaded = load(content) as Manifest;
    manifest = loaded;
  } catch (err) {
    const error = err as Error;
    console.error("⚠️  Failed to read manifest:", error.message);
    process.exit(1);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  try {
    const selection = await getContextSelection(manifest, rl);

    if (!selection) {
      console.info("👋 Removal cancelled.");
      return;
    }

    const confirmed = force || (await confirmRemoval(selection, rl));

    if (!confirmed) {
      console.info("👋 Removal cancelled.");
      return;
    }

    console.info(`\n➡️  Removing context '${selection}'`);

    const updatedManifest = removeContextFromManifest(manifest, selection);

    // Atomic save
    const tempPath = `${manifestPath}.tmp`;
    try {
      mkdirSync(`${cwd}/.architecture`, { recursive: true });
      writeFileSync(tempPath, generateManifestYaml(updatedManifest), "utf-8");
      renameSync(tempPath, manifestPath);

      console.info(`\n✅ Context '${selection}' removed from manifest.yaml`);
    } catch (saveErr: unknown) {
      const saveError = saveErr as Error;
      try {
        unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      console.warn("⚠️  Failed to save manifest:", saveError.message);
      process.exit(1);
    }
  } finally {
    rl.close();
  }
}
