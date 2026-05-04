/* eslint-disable no-console */
import { Command } from "commander";
import { runRefactoring } from "./refactor-shared.js";

export function registerRenameEntityCommand(parent: Command): void {
  parent
    .command("rename-entity")
    .description("Rename a domain entity and update all references")
    .argument("<current-name>", "Current entity class name")
    .argument("<new-name>", "New entity class name")
    .option("--dry-run", "Preview changes without applying them")
    .option("--skip-validation", "Skip validation suite (not recommended)")
    .option("--no-auto-commit", "Don't auto-commit on success")
    .action(async (currentName: string, newName: string, options) => {
      try {
        await runRefactoring(
          {
            type: "rename-entity",
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
