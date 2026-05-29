#!/usr/bin/env node
/* eslint-disable no-console */

import { Command } from "commander";
import { SyncEngine } from "./sync-engine.js";
import { listCommand, validateCommand } from "./commands/arch/index.js";
import { portCommander } from "./commands/arch/port.js";
import { contextCommander } from "./commands/arch/context/command.js";
import { removeCommander } from "./commands/arch/remove.js";
import { diffCommander } from "./commands/arch/diff.js";
import {
  listTemplatesCommand,
  templateInfoCommand,
} from "./commands/templates/index.js";
import { addTemplateCommand } from "./commands/add/index.js";
import { validateTemplatesCommand } from "./commands/add/validate.js";
import { editCommander } from "./commands/arch/edit.js";
import { refactorCommander } from "./commands/arch/refactor.js";
import { manifestCommander } from "./commands/manifest/index.js";
import type { LoggerPort } from "@hexagen/shared";

function createLogger(): LoggerPort {
  return {
    error: (msg, ctx) => console.error(`[sync] ${msg}`, ctx ?? ""),
    warn: (msg, ctx) => console.warn(`[sync] ${msg}`, ctx ?? ""),
    info: (msg, ctx) => console.log(`[sync] ${msg}`, ctx ?? ""),
    debug: (msg, ctx) => {
      if (process.env.DEBUG) console.log(`[debug] ${msg}`, ctx ?? "");
    },
    errorWithException: (err, msg, ctx) => {
      const errorMessage =
        msg ?? (err instanceof Error ? err.message : String(err));
      console.error(`[sync] ${errorMessage}`, ctx ?? "");
      if (err instanceof Error && err.stack) {
        console.error(err.stack);
      }
    },
  };
}

const logger = createLogger();

function buildProgram(): Command {
  const program = new Command();

  program
    .name("hexagen")
    .description("HexaGen Monaco — Generate and sync modular monorepos")
    .version("0.1.0");

  program
    .command("sync")
    .description("Run the HexaGen sync engine to generate artifacts")
    .option("--dry-run", "Preview changes without writing files")
    .option("--force", "Overwrite non-generated files in packages")
    .option(
      "--force-root",
      "Overwrite protected root files (turbo.json, .gitignore)",
    )
    .option("--allow-dirty", "Skip git clean check (for development)")
    .option("--strict", "Fail on architecture linter warnings")
    .action(async (options) => {
      const flags = {
        dryRun: options.dryRun ?? false,
        force: options.force ?? false,
        forceRoot: options.forceRoot ?? false,
        allowDirty: options.allowDirty ?? false,
        strict: options.strict ?? false,
        mode: "self-regen" as const,
        logger,
      };

      try {
        const engine = new SyncEngine(flags);
        await engine.run();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown fatal error";
        console.error(`Fatal sync error: ${message}`);
        process.exit(1);
      }
    });

  const archCommand = program
    .command("arch")
    .description("Manage architecture manifest.yaml");

  archCommand
    .command("list")
    .description("Display manifest.yaml in tabular format")
    .action(async () => {
      await listCommand();
    });

  archCommand
    .command("validate")
    .description("Validate manifest.yaml against linter rules")
    .action(async () => {
      await validateCommand();
    });

  archCommand.addCommand(portCommander);
  archCommand.addCommand(contextCommander);
  archCommand.addCommand(removeCommander);
  archCommand.addCommand(diffCommander);
  archCommand.addCommand(editCommander);
  archCommand.addCommand(refactorCommander);

  program.addCommand(manifestCommander);

  // hexagen templates list / info
  const templatesCommand = program
    .command("templates")
    .description("Manage and inspect add-on templates");

  templatesCommand
    .command("list")
    .description("List all available add-on templates")
    .action(async () => {
      await listTemplatesCommand();
    });

  templatesCommand
    .command("info <id>")
    .description("Show detailed information about a template")
    .action(async (id: string) => {
      await templateInfoCommand(id);
    });

  // hexagen add <template-id>
  program
    .command("add <ids...>")
    .description("Apply one or more add-on templates to the current project")
    .option("--force", "Re-apply already-installed templates")
    .action(async (ids: string[], options: { force?: boolean }) => {
      await addTemplateCommand(ids, { force: options.force });
    });

  // hexagen validate templates
  program
    .command("validate-templates")
    .description(
      "Validate installed templates — check output files, env vars, and conflict files",
    )
    .action(async () => {
      await validateTemplatesCommand();
    });

  return program;
}

const program = buildProgram();

try {
  program.parse(process.argv);
} catch (err) {
  const message = err instanceof Error ? err.message : "Unknown CLI error";
  console.error(`CLI error: ${message}`);
  process.exit(1);
}
