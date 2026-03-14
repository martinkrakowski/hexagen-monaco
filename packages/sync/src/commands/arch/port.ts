import { Command } from "commander";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "fs";
import * as readline from "node:readline";
import yaml from "js-yaml";
import type { Manifest } from "@hexagen/sync";
import { generateManifestYaml } from "./port/persistence.js";

// Local interface definition (temporary until validation.ts is created)
interface PortDefinition {
  name: string;
  context: string;
  direction: "in" | "out";
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

interface UniquenessResult {
  valid: boolean;
  errors: string[];
  hint?: string;
}

// Local validation functions (temporary until validation.ts is created in Phase 3)
function validatePortInput(
  portDef: PortDefinition,
  manifest: Manifest,
): ValidationResult {
  const errors: string[] = [];

  // PascalCase format check
  if (!/^[A-Z][a-zA-Z0-9]*$/.test(portDef.name)) {
    errors.push("⚠️ Port name must be PascalCase (e.g., FooPort)");
  }

  // Context existence check (using snake_case property name)
  const contextExists = manifest.bounded_contexts?.some(
    (ctx: { name: string }) => ctx.name === portDef.context,
  );
  if (!contextExists) {
    errors.push(`⚠️ Context '${portDef.context}' does not exist`);
  }

  // Port type validation
  if (!["in", "out"].includes(portDef.direction)) {
    errors.push("⚠️ Port direction must be 'in' or 'out'");
  }

  return { valid: errors.length === 0, errors };
}

function checkPortUniqueness(
  portName: string,
  contextName: string,
  manifest: Manifest,
): UniquenessResult {
  // Check if port already exists in the context (using snake_case property names)
  const existingContext = manifest.bounded_contexts?.find(
    (ctx: { name: string }) => ctx.name === contextName,
  );

  if (!existingContext) {
    return { valid: true, errors: [] };
  }

  // Check application layer ports (most common location for port declarations)
  const appPorts = existingContext.layers?.application?.ports;
  const inPortExists = appPorts?.in?.includes(portName);
  const outPortExists = appPorts?.out?.includes(portName);

  if (inPortExists || outPortExists) {
    return {
      valid: false,
      errors: [
        `⚠️ Port '${portName}' already declared in context '${contextName}'`,
      ],
      hint: "Use a different name or remove the existing port first",
    };
  }

  return { valid: true, errors: [] };
}

interface WizardSessionState {
  portName: string | null;
  contextName: string | null;
  portType: "in" | "out" | null;
}

function createWizardSession(): WizardSessionState {
  return {
    portName: null,
    contextName: null,
    portType: null,
  };
}

// Helper: wrap synchronous question() in a Promise for async/await support
function ask(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function collectPortDefinition(
  session: WizardSessionState,
  manifest: Manifest,
  rl: readline.Interface,
): Promise<WizardSessionState> {
  // Step 1: Collect port name (with format validation)
  while (!session.portName) {
    const prompt = "Enter port name (PascalCase, e.g., FooPort): ";
    const answer = await ask(rl, prompt);

    if (/^[A-Z][a-zA-Z0-9]*$/.test(answer)) {
      session.portName = answer;
    } else {
      console.warn("⚠️ Port name must be PascalCase (e.g., FooPort)");
    }
  }

  // Step 2: Collect context name from available contexts
  const contextNames =
    manifest.bounded_contexts?.map((ctx: { name: string }) => ctx.name) ?? [];

  while (!session.contextName) {
    console.info("\nAvailable bounded contexts:");
    contextNames.forEach((name: string, index: number) => {
      console.info(`  ${index + 1}. ${name}`);
    });

    const answer = await ask(rl, "Select context number (or name): ");

    // Try numeric selection first
    const numIndex = parseInt(answer, 10) - 1;
    if (!isNaN(numIndex) && numIndex >= 0 && numIndex < contextNames.length) {
      session.contextName = contextNames[numIndex];
    } else if (contextNames.includes(answer)) {
      // Direct name match
      session.contextName = answer;
    } else {
      console.warn("⚠️ Invalid selection. Please try again.");
    }
  }

  // Step 3: Collect port type (inbound vs outbound)
  while (!session.portType) {
    const answer = await ask(rl, "\nPort type (in/out): ");

    if (answer.toLowerCase() === "in") {
      session.portType = "in";
    } else if (answer.toLowerCase() === "out") {
      session.portType = "out";
    } else {
      console.warn("⚠️ Port type must be 'in' or 'out'. Please try again.");
    }
  }

  return session;
}

async function runWizardSession(
  manifest: Manifest,
): Promise<PortDefinition | null> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  try {
    console.info("\n🔧 Starting port scaffolding wizard...\n");

    // Collect user input through prompts
    const session = await collectPortDefinition(
      createWizardSession(),
      manifest,
      rl,
    );

    // Construct port definition
    const portDef: PortDefinition = {
      name: session.portName!,
      context: session.contextName!,
      direction: session.portType!,
    };

    console.info("\n✅ Collected port definition:");
    console.log(`   Name: ${portDef.name}`);
    console.log(`   Context: ${portDef.context}`);
    console.info(
      `   Direction: ${portDef.direction === "in" ? "Inbound" : "Outbound"}\n`,
    );

    // Validate against invariants (format + uniqueness check)
    const validation = validatePortInput(portDef, manifest);
    const uniquenessCheck = checkPortUniqueness(
      portDef.name,
      portDef.context,
      manifest,
    );

    if (!uniquenessCheck.valid) {
      validation.errors.push(...uniquenessCheck.errors);
    }

    if (!validation.valid) {
      console.warn("⚠️ Validation failed:");
      validation.errors.forEach((error) => console.info(`   ${error}`));

      // Ask user if they want to retry or cancel
      const retryAnswer = await ask(rl, "\nRetry? (y/n): ");
      if (retryAnswer?.toLowerCase() === "y") {
        return runWizardSession(manifest); // Recursive retry
      } else {
        console.info("👋 Wizard cancelled by user.");
        return null;
      }
    }

    return portDef;
  } finally {
    rl.close();
  }
}

export async function portCommand(): Promise<void> {
  const cwd = process.cwd();

  // Load current manifest state (using inline function for now)
  try {
    const manifestPath = `${cwd}/.architecture/manifest.yaml`;
    const manifestContent = readFileSync(manifestPath, "utf-8");
    const manifest: Manifest = yaml.load(manifestContent) as Manifest;

    // Run interactive wizard session
    const portDef = await runWizardSession(manifest);

    if (!portDef) {
      console.info("👋 Wizard cancelled.");
      return;
    }

    // Persist changes atomically to manifest.yaml
    const updatedManifest: Manifest = {
      ...manifest,
      bounded_contexts: manifest.bounded_contexts!.map((ctx) =>
        ctx.name === portDef.context
          ? {
              ...ctx,
              layers: {
                ...ctx.layers,
                application: {
                  ...ctx.layers?.application,
                  ports: {
                    ...(ctx.layers?.application?.ports || {}),
                    [portDef.direction]: [
                      ...(ctx.layers?.application?.ports?.[portDef.direction] ??
                        []),
                      portDef.name,
                    ],
                  },
                },
              },
            }
          : ctx,
      ),
    };

    // Atomic save using persistence module (YAML template formatting)
    const tempPath = `${manifestPath}.tmp`;
    try {
      mkdirSync(`${cwd}/.architecture`, { recursive: true });
      writeFileSync(tempPath, generateManifestYaml(updatedManifest), "utf-8");
      renameSync(tempPath, manifestPath);

      console.info(
        `\n✅ Port '${portDef.name}' added successfully to context '${portDef.context}'`,
      );
    } catch (saveErr: unknown) {
      const saveError = saveErr as Error;
      try {
        unlinkSync(tempPath);
      } catch {
        // Ignore cleanup errors — primary error is more important
      }
      console.warn("⚠️ Failed to update manifest:", saveError.message);
      process.exit(1);
    }
  } catch (err: unknown) {
    const error = err as Error;
    console.error("⚠️ Failed to read manifest:", error.message);
    process.exit(1);
  }
}

// Commander.js command registration (inline for now, will move to cli.ts later)
export const portCommander = new Command("port").description(
  "Scaffold a new port interactively",
);

portCommander.action(portCommand);
