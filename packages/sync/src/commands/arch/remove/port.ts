/* eslint-disable no-console */
import { Command } from "commander";
import { writeFileSync, mkdirSync, renameSync, unlinkSync } from "fs";
import type { Manifest } from "@hexagen/sync";
import { portName } from "../../../types/manifest.js";
import { generateManifestYaml } from "../port/persistence.js";
import {
  getProjectRoot,
  yamlService,
  confirm,
  promptService,
} from "../../shared/index.js";

export interface RemovePortOptions {
  force?: boolean;
}

export const removePortCommander = new Command("port")
  .description("Remove a port from a bounded context")
  .action(async (_options: RemovePortOptions, cmd: Command) => {
    const { force } = cmd.optsWithGlobals();
    await removePortCommand({ force });
  });

async function getPortSelection(manifest: Manifest): Promise<{
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
      for (const raw of appPorts.in) {
        const portNameStr = portName(raw);
        allPorts.push({
          contextName: ctx.name,
          portName: portNameStr,
          direction: "in",
        });
      }
    }
    if (appPorts?.out) {
      for (const raw of appPorts.out) {
        const portNameStr = portName(raw);
        allPorts.push({
          contextName: ctx.name,
          portName: portNameStr,
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

  const answer = await promptService.ask("\nSelect port number to remove: ");
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

async function confirmRemoval(port: {
  contextName: string;
  portName: string;
  direction: string;
}): Promise<boolean> {
  return confirm(
    `Are you sure you want to remove port '${port.portName}' from context '${port.contextName}'?`,
  );
}

function removePortFromManifest(
  manifest: Manifest,
  contextName: string,
  targetPortName: string,
  direction: "in" | "out",
): Manifest {
  return {
    ...manifest,
    bounded_contexts: manifest.bounded_contexts?.map((ctx) => {
      if (ctx.name !== contextName) {
        return ctx;
      }

      const currentPorts = ctx.layers?.application?.ports?.[direction] ?? [];
      const filteredPorts = currentPorts.filter(
        (p) => portName(p) !== targetPortName,
      );

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

export async function removePortCommand(
  options: RemovePortOptions = {},
): Promise<void> {
  const cwd = getProjectRoot();
  const manifestPath = `${cwd}/.architecture/manifest.yaml`;
  const force = options.force ?? false;

  const loadResult = await yamlService.loadManifest(manifestPath);
  if (!loadResult.success) {
    console.error("⚠️ Failed to read manifest:", loadResult.error.message);
    process.exit(1);
  }
  const manifest = loadResult.value;

  try {
    const selection = await getPortSelection(manifest);

    if (!selection) {
      console.info("👋 Removal cancelled.");
      return;
    }

    const confirmed = force || (await confirmRemoval(selection));

    if (!confirmed) {
      console.info("👋 Removal cancelled.");
      return;
    }

    console.info(
      `\n➡️  Removing port '${selection.portName}' from context '${selection.contextName}'`,
    );

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
    promptService.close();
  }
}
