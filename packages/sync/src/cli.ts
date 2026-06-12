#!/usr/bin/env node
/* eslint-disable no-console */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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

// Read the real version from the package manifest rather than hardcoding it.
// dist/cli.js (and src/cli.ts in dev) both sit one level under the package
// root, so ../package.json resolves correctly in the published bundle and the
// monorepo alike.
function readVersion(): string {
  try {
    const pkgPath = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "package.json",
    );
    return JSON.parse(readFileSync(pkgPath, "utf8")).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function buildProgram(): Command {
  const program = new Command();

  program
    .name("hexagen")
    .description("HexaGen Monaco — Generate and sync modular monorepos")
    .version(readVersion());

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
    .option(
      "--only <pattern...>",
      "Limit writes to workspace-relative paths/globs (e.g. packages/shared, 'packages/*/tsconfig.json'). Direct targets only — no dependency fan-out; run a full sync for cross-package changes.",
    )
    .option(
      "--report <path>",
      "Migration-report destination (relative to the workspace root). Real runs default to SYNC-MIGRATION-REPORT.md; --dry-run writes no report unless this is set.",
    )
    .action(async (options) => {
      const flags = {
        dryRun: options.dryRun ?? false,
        force: options.force ?? false,
        forceRoot: options.forceRoot ?? false,
        allowDirty: options.allowDirty ?? false,
        strict: options.strict ?? false,
        only: options.only as string[] | undefined,
        report: options.report as string | undefined,
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
        // exitCode (not process.exit) lets stdio flush and the event loop
        // drain; the process exits non-zero once teardown completes.
        process.exitCode = 1;
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

// parseAsync (not parse): every subcommand action is async, and parse() does
// not await them — a rejected action became an unhandled rejection instead of
// landing in this catch. Top-level await is safe here (ESM, es2022).
try {
  await program.parseAsync(process.argv);
} catch (err) {
  const message = err instanceof Error ? err.message : "Unknown CLI error";
  console.error(`CLI error: ${message}`);
  process.exitCode = 1;
}
