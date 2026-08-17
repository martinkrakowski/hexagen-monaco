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
import { adoptCommander } from "./commands/adopt/index.js";
import { bootstrapCommander } from "./commands/bootstrap/index.js";
import { runReportCommand } from "./commands/report/index.js";
import { resolveToolchainVersion } from "./toolchain-version.js";
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

  // PR-A3 (RCA #1): the version is a build-injected constant in dist (tsup
  // define) and a validated package.json read under src execution — the old
  // readVersion() helper here silently fell back to "0.0.0", which both lied
  // in `--version` output and masked the broken-bundle case. A failure to
  // resolve now crashes the CLI loudly instead of reporting a fake version.
  program
    .name("hexagen")
    .description("HexaGen Monaco — Generate and sync modular monorepos")
    .version(resolveToolchainVersion());

  program
    .command("sync")
    .description("Run the HexaGen sync engine to generate artifacts")
    .option("--dry-run", "Preview changes without writing files")
    .option(
      "--check",
      "CI drift gate: implies --dry-run and exits non-zero iff any change would be made (created/updated/deleted). A converged tree exits 0.",
    )
    .option("--force", "Overwrite non-generated files in packages")
    .option(
      "--force-root",
      "Overwrite protected root files (turbo.json, .gitignore)",
    )
    .option("--allow-dirty", "Skip git clean check (for development)")
    .option(
      "--strict",
      "Abort the sync when the architecture linter reports a violation (or cannot verify)",
    )
    .option(
      "--only <pattern...>",
      "Limit writes to workspace-relative paths/globs (e.g. packages/shared, 'packages/*/tsconfig.json'). Direct targets only — no dependency fan-out; run a full sync for cross-package changes.",
    )
    .option(
      "--report <path>",
      "Migration-report destination, resolved against the workspace root (absolute paths allowed; parent dirs are created). Real runs default to SYNC-MIGRATION-REPORT.md; --dry-run writes no report unless this is set.",
    )
    .action(async (options) => {
      // --check is resolved here at the CLI boundary (PR-B2, RCA #5): it is
      // exactly a --dry-run whose totalOps drives the exit code, so the engine
      // never learns about it — `run()` reports, the CLI decides (A1 doctrine,
      // same as the Fatal-error path below).
      const check = options.check ?? false;
      const flags = {
        dryRun: (options.dryRun || options.check) ?? false,
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
        const summary = await engine.run();
        // B-1 (PR-B2 review): a failed-soft generator (caught into
        // result.error, Wave-2e contract) plans zero ops, so it is invisible
        // to the drift branch below — without this check a run that could not
        // even plan a file exited 0 with `Total ops : 0`, on real runs,
        // --dry-run and --check alike. Errors are a failure, not drift: this
        // branch applies to EVERY mode (A1 honest-exit doctrine), while the
        // drift branch stays --check-only.
        if (summary.errors > 0) {
          console.error(
            `Sync incomplete: ${summary.errors} generator failure(s) — see the FAILED row(s) above.`,
          );
          process.exitCode = 1;
        }
        // A missing manifest is a precondition failure, not drift (it plans
        // zero ops, so the drift branch below would silently pass it). cwd-first
        // root resolution (Wave C) makes a wrong-root, manifest-less run
        // reachable just by standing in the wrong directory — a verification
        // gate must refuse to certify a tree it never measured. --check only;
        // plain --dry-run keeps its empty-manifest preview tolerance.
        if (check && summary.manifestMissing) {
          console.error(
            "Manifest not found — `--check` cannot verify drift without a manifest at " +
              "`.architecture/manifest.yaml`. Check you are running from inside the intended " +
              "workspace (cwd is resolved first).",
          );
          process.exitCode = 1;
        }
        if (check && summary.totalOps > 0) {
          console.error(
            `Drift detected: ${summary.totalOps} pending change(s) (${summary.created} to create, ${summary.updated} to update, ${summary.deleted} to delete). Run \`hexagen sync\` to converge.`,
          );
          process.exitCode = 1;
        }
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
  program.addCommand(adoptCommander);
  program.addCommand(bootstrapCommander);

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
    .option(
      "--with-tests",
      "Also emit each template's test scaffolds (skipped by default)",
    )
    .action(
      async (
        ids: string[],
        options: { force?: boolean; withTests?: boolean },
      ) => {
        await addTemplateCommand(ids, {
          force: options.force,
          withTests: options.withTests,
        });
      },
    );

  // hexagen validate templates
  program
    .command("validate-templates")
    .description(
      "Validate installed templates — check output files, env vars, and conflict files",
    )
    .action(async () => {
      await validateTemplatesCommand();
    });

  // hexagen report [--handoff]
  // 0.10.0 unpublished contract — not present on the published 0.9.0 tarball.
  program
    .command("report")
    .description(
      "Write a self-contained HTML/Markdown engagement report (context map, drift, ratchet trend, suppression ledger)",
    )
    .option("--format <html|md|both>", "Output format (default both)", "both")
    .option(
      "--out <dir>",
      "Directory for hexagen-report.html / hexagen-report.md (default: project root)",
    )
    .option(
      "--handoff",
      "Also write hexagen-handoff.zip (report + manifest + layout + baseline + ledger)",
    )
    .option(
      "--handoff-out <path>",
      "Handoff zip path (default: <out>/hexagen-handoff.zip)",
    )
    .action(async (options) => {
      const format = options.format as string;
      if (format !== "html" && format !== "md" && format !== "both") {
        throw new Error("--format must be html, md, or both");
      }
      await runReportCommand({
        format,
        out: options.out as string | undefined,
        handoff: Boolean(options.handoff),
        handoffOut: options.handoffOut as string | undefined,
      });
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
