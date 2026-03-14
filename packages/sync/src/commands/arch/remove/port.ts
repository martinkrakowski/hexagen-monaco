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

export const removePortCommander = new Command("port")
  .description("Remove a port from a bounded context")
  .action(removePortCommand);

function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function getPortSelection(
  manifest: Manifest,
  rl: readline.Interface,
): Promise<{
  contextName: string;
  portName: string;
  direction: string;
} | null> {
  const contexts = manifest.bounded_contexts ?? [];

  if (contexts.length === 0) {
    console.info("⚠️  No bounded contexts found in manifest.");
    return null;
  }

  // Collect all ports across all contexts
  const allPorts: {
    contextName: string;
    portName: string;
    direction: string;
  }[] = [];

  for (const ctx of contexts) {
    const appPorts = ctx.layers?.application?.ports;
    if (appPorts?.in) {
      for (const portName of appPorts.in) {
        allPorts.push({
          contextName: ctx.name,
          portName,
          direction: "in",
        });
      }
    }
    if (appPorts?.out) {
      for (const portName of appPorts.out) {
        allPorts.push({
          contextName: ctx.name,
          portName,
          direction: "out",
        });
      }
    }
  }

  if (allPorts.length === 0) {
    console.info("⚠️  No ports found in any context.");
    return null;
  }

  console.info("\n📋 Available ports:\n");
  allPorts.forEach((port, index) => {
    console.info(
      `  ${index + 1}. ${port.contextName}/${port.direction}:${port.portName}`,
    );
  });

  const answer = await ask(rl, "\nSelect port number to remove: ");
  const numIndex = parseInt(answer, 10) - 1;

  if (isNaN(numIndex) || numIndex < 0 || numIndex >= allPorts.length) {
    console.warn("⚠️  Invalid selection.");
    return null;
  }

  const selected = allPorts[numIndex];
  console.info(
    `\n➡️  Selected: ${selected.contextName}/${selected.direction}:${selected.portName}`,
  );

  return selected;
}

async function confirmRemoval(
  port: { contextName: string; portName: string; direction: string },
  rl: readline.Interface,
): Promise<boolean> {
  const answer = await ask(
    rl,
    `\nAre you sure you want to remove port '${port.portName}' from context '${port.contextName}'? (y/n): `,
  );

  return answer.toLowerCase() === "y";
}

function removePortFromManifest(
  manifest: Manifest,
  contextName: string,
  portName: string,
  direction: "in" | "out",
): Manifest {
  return {
    ...manifest,
    bounded_contexts: manifest.bounded_contexts?.map((ctx) => {
      if (ctx.name !== contextName) {
        return ctx;
      }

      const currentPorts = ctx.layers?.application?.ports?.[direction] ?? [];
      const filteredPorts = currentPorts.filter((p) => p !== portName);

      return {
        ...ctx,
        layers: {
          ...ctx.layers,
          application: {
            ...ctx.layers?.application,
            ports: {
              ...ctx.layers?.application?.ports,
              [direction]: filteredPorts,
            },
          },
        },
      };
    }),
  };
}

export async function removePortCommand(): Promise<void> {
  const cwd = process.cwd();
  const manifestPath = `${cwd}/.architecture/manifest.yaml`;

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
    const selection = await getPortSelection(manifest, rl);

    if (!selection) {
      console.info("👋 Removal cancelled.");
      return;
    }

    const confirmed = await confirmRemoval(selection, rl);

    if (!confirmed) {
      console.info("👋 Removal cancelled.");
      return;
    }

    const updatedManifest = removePortFromManifest(
      manifest,
      selection.contextName,
      selection.portName,
      selection.direction as "in" | "out",
    );

    // Atomic save
    const tempPath = `${manifestPath}.tmp`;
    try {
      mkdirSync(`${cwd}/.architecture`, { recursive: true });
      writeFileSync(tempPath, generateManifestYaml(updatedManifest), "utf-8");
      renameSync(tempPath, manifestPath);

      console.info(
        `\n✅ Port '${selection.portName}' removed from context '${selection.contextName}'`,
      );
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
