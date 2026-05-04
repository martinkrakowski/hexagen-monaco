/* eslint-disable no-console */
import { Command } from "commander";
import { runRefactoring } from "./refactor-shared.js";

export function registerRenamePortCommand(parent: Command): void {
  parent
    .command("rename-port")
    .description("Rename a port interface and update all references")
    .argument("<current-name>", "Current port interface name")
    .argument("<new-name>", "New port interface name")
    .option("--dry-run", "Preview changes without applying them")
    .option("--skip-validation", "Skip validation suite (not recommended)")
    .option("--no-auto-commit", "Don't auto-commit on success")
    .action(async (currentName: string, newName: string, options) => {
      try {
        await runRefactoring(
          {
            type: "rename-port",
            target: currentName,
            newName,
          },
          {
            dryRun: options.dryRun,
            skipValidation: options.skipValidation,
            autoCommit: options.autoCommit ?? true,
          },
        );
      } catch (error) {
        console.error(
          "\n❌ Fatal error:",
          error instanceof Error ? error.message : String(error),
        );
        process.exit(1);
      }
    });
}
