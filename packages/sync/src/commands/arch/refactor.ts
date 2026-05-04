/* eslint-disable no-console */
import { Command } from "commander";
import { ImpactAnalyzer } from "../../refactoring/impact-analyzer.js";
import { loadManifest } from "../../manifest-service.js";
import { registerRenamePortCommand } from "./refactor-rename-port.js";
import { registerRenameUseCaseCommand } from "./refactor-rename-use-case.js";
import { registerRenameEntityCommand } from "./refactor-rename-entity.js";

export const refactorCommander = new Command("refactor").description(
  "Safe refactoring operations with validation and rollback",
);

registerRenamePortCommand(refactorCommander);
registerRenameUseCaseCommand(refactorCommander);
registerRenameEntityCommand(refactorCommander);

refactorCommander
  .command("analyze")
  .description("Analyze refactoring impact without making changes")
  .argument(
    "<type>",
    "Refactoring type (rename-port, rename-use-case, rename-entity)",
  )
  .argument("<current-name>", "Current name")
  .argument("<new-name>", "New name")
  .action(async (type: string, currentName: string, newName: string) => {
    try {
      if (!["rename-port", "rename-use-case", "rename-entity"].includes(type)) {
        console.error(
          "❌ Invalid refactoring type. Must be: rename-port, rename-use-case, or rename-entity",
        );
        process.exit(1);
      }

      const workspaceRoot = process.cwd();

      console.log("\n🔍 Loading manifest...");
      const manifestResult = await loadManifest(workspaceRoot);

      if (!manifestResult.success) {
        console.error(
          "❌ Failed to load manifest:",
          manifestResult.error.message,
        );
        process.exit(1);
      }

      const manifest = manifestResult.value;

      console.log("🔍 Analyzing impact...");
      const analyzer = new ImpactAnalyzer(workspaceRoot, manifest);
      const impactResult = await analyzer.analyze({
        type: type as "rename-port" | "rename-use-case" | "rename-entity",
        target: currentName,
        newName,
      });

      if (!impactResult.success) {
        console.error("❌ Impact analysis failed:", impactResult.error.message);
        process.exit(1);
      }

      const impact = impactResult.value;

      console.log("\n📊 Impact Analysis Report");
      console.log("=".repeat(50));
      console.log(`\nRefactoring: ${type}`);
      console.log(`Current name: ${currentName}`);
      console.log(`New name: ${newName}`);

      console.log(`\n📁 Files to modify: ${impact.filesToModify.length}`);
      impact.filesToModify.forEach((file) => {
        console.log(`\n   ${file.path}`);
        console.log(`   Layer: ${file.layer}`);
        console.log(`   Reason: ${file.reason}`);
      });

      if (impact.crossPackageDeps.length > 0) {
        console.log(
          `\n🔗 Cross-package dependencies: ${impact.crossPackageDeps.length}`,
        );
        impact.crossPackageDeps.forEach((dep) => {
          console.log(`   ${dep.fromPackage} → ${dep.toPackage}`);
        });
      }

      if (impact.warnings.length > 0) {
        console.log(`\n⚠️  Warnings: ${impact.warnings.length}`);
        impact.warnings.forEach((warning) => console.log(`   - ${warning}`));
      }

      console.log("\n" + "=".repeat(50));
      console.log("✅ Analysis complete. No changes applied.");
    } catch (error) {
      console.error(
        "\n❌ Fatal error:",
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    }
  });
