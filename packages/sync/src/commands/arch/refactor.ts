// refactor.ts – CLI command for safe refactoring operations
// Part of Phase 7.6: CLI Integration & Testing

import { Command } from "commander";
import { ImpactAnalyzer } from "../../refactoring/impact-analyzer.js";
import { SafeRefactoringOrchestrator } from "../../refactoring/safe-refactoring-orchestrator.js";
import { loadManifest } from "../../manifest-service.js";

/**
 * Create the refactor command
 */
export const refactorCommander = new Command("refactor").description(
  "Safe refactoring operations with validation and rollback",
);

/**
 * Rename port command
 */
refactorCommander
  .command("rename-port")
  .description("Rename a port interface and update all references")
  .argument("<current-name>", "Current port interface name")
  .argument("<new-name>", "New port interface name")
  .option("--dry-run", "Preview changes without applying them")
  .option("--skip-validation", "Skip validation suite (not recommended)")
  .option("--no-auto-commit", "Don't auto-commit on success")
  .action(async (currentName: string, newName: string, options) => {
    try {
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
        type: "rename-port",
        target: currentName,
        newName,
      });

      if (!impactResult.success) {
        console.error("❌ Impact analysis failed:", impactResult.error.message);
        process.exit(1);
      }

      const impact = impactResult.value;

      // Display impact summary
      console.log("\n📊 Impact Analysis:");
      console.log(`   Files to modify: ${impact.filesToModify.length}`);
      console.log(
        `   Cross-package dependencies: ${impact.crossPackageDeps.length}`,
      );

      if (impact.warnings.length > 0) {
        console.log("\n⚠️  Warnings:");
        impact.warnings.forEach((warning) => console.log(`   - ${warning}`));
      }

      console.log("\n📝 Files to modify:");
      impact.filesToModify.forEach((file) => {
        console.log(`   ${file.path}`);
        console.log(`      ${file.reason}`);
      });

      if (options.dryRun) {
        console.log("\n✅ Dry run complete. No changes applied.");
        return;
      }

      // Confirm before proceeding
      console.log(
        "\n⚠️  This will modify the files listed above. Continue? (y/N)",
      );
      const readline = await import("node:readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question("", resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== "y") {
        console.log("❌ Refactoring cancelled.");
        return;
      }

      console.log("\n🔧 Executing refactoring...");
      const orchestrator = new SafeRefactoringOrchestrator(
        workspaceRoot,
        manifest,
      );

      const config = options.skipValidation
        ? SafeRefactoringOrchestrator.getFastConfig()
        : SafeRefactoringOrchestrator.getDefaultConfig();

      config.autoCommit = options.autoCommit ?? true;

      const result = await orchestrator.executeWithValidation(
        {
          type: "rename-port",
          target: currentName,
          newName,
        },
        config,
      );

      if (!result.success) {
        console.error("\n❌ Refactoring failed:", result.error.message);
        process.exit(1);
      }

      const refactoringResult = result.value;

      console.log("\n✅ Refactoring complete!");
      console.log(
        `   Files modified: ${refactoringResult.filesModified.length}`,
      );

      if (refactoringResult.warnings.length > 0) {
        console.log("\n⚠️  Warnings:");
        refactoringResult.warnings.forEach((warning) =>
          console.log(`   - ${warning}`),
        );
      }

      if (config.autoCommit) {
        console.log("\n✅ Changes committed to git.");
      } else {
        console.log("\n⚠️  Changes not committed. Review and commit manually.");
      }
    } catch (error) {
      console.error(
        "\n❌ Fatal error:",
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    }
  });

/**
 * Rename use case command
 */
refactorCommander
  .command("rename-use-case")
  .description("Rename a use case class and update all references")
  .argument("<current-name>", "Current use case class name")
  .argument("<new-name>", "New use case class name")
  .option("--dry-run", "Preview changes without applying them")
  .option("--skip-validation", "Skip validation suite (not recommended)")
  .option("--no-auto-commit", "Don't auto-commit on success")
  .action(async (currentName: string, newName: string, options) => {
    try {
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
        type: "rename-use-case",
        target: currentName,
        newName,
      });

      if (!impactResult.success) {
        console.error("❌ Impact analysis failed:", impactResult.error.message);
        process.exit(1);
      }

      const impact = impactResult.value;

      // Display impact summary
      console.log("\n📊 Impact Analysis:");
      console.log(`   Files to modify: ${impact.filesToModify.length}`);
      console.log(
        `   Cross-package dependencies: ${impact.crossPackageDeps.length}`,
      );

      if (impact.warnings.length > 0) {
        console.log("\n⚠️  Warnings:");
        impact.warnings.forEach((warning) => console.log(`   - ${warning}`));
      }

      console.log("\n📝 Files to modify:");
      impact.filesToModify.forEach((file) => {
        console.log(`   ${file.path}`);
        console.log(`      ${file.reason}`);
      });

      if (options.dryRun) {
        console.log("\n✅ Dry run complete. No changes applied.");
        return;
      }

      // Confirm before proceeding
      console.log(
        "\n⚠️  This will modify the files listed above. Continue? (y/N)",
      );
      const readline = await import("node:readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question("", resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== "y") {
        console.log("❌ Refactoring cancelled.");
        return;
      }

      console.log("\n🔧 Executing refactoring...");
      const orchestrator = new SafeRefactoringOrchestrator(
        workspaceRoot,
        manifest,
      );

      const config = options.skipValidation
        ? SafeRefactoringOrchestrator.getFastConfig()
        : SafeRefactoringOrchestrator.getDefaultConfig();

      config.autoCommit = options.autoCommit ?? true;

      const result = await orchestrator.executeWithValidation(
        {
          type: "rename-use-case",
          target: currentName,
          newName,
        },
        config,
      );

      if (!result.success) {
        console.error("\n❌ Refactoring failed:", result.error.message);
        process.exit(1);
      }

      const refactoringResult = result.value;

      console.log("\n✅ Refactoring complete!");
      console.log(
        `   Files modified: ${refactoringResult.filesModified.length}`,
      );

      if (refactoringResult.warnings.length > 0) {
        console.log("\n⚠️  Warnings:");
        refactoringResult.warnings.forEach((warning) =>
          console.log(`   - ${warning}`),
        );
      }

      if (config.autoCommit) {
        console.log("\n✅ Changes committed to git.");
      } else {
        console.log("\n⚠️  Changes not committed. Review and commit manually.");
      }
    } catch (error) {
      console.error(
        "\n❌ Fatal error:",
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    }
  });

/**
 * Rename entity command
 */
refactorCommander
  .command("rename-entity")
  .description("Rename a domain entity and update all references")
  .argument("<current-name>", "Current entity class name")
  .argument("<new-name>", "New entity class name")
  .option("--dry-run", "Preview changes without applying them")
  .option("--skip-validation", "Skip validation suite (not recommended)")
  .option("--no-auto-commit", "Don't auto-commit on success")
  .action(async (currentName: string, newName: string, options) => {
    try {
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
        type: "rename-entity",
        target: currentName,
        newName,
      });

      if (!impactResult.success) {
        console.error("❌ Impact analysis failed:", impactResult.error.message);
        process.exit(1);
      }

      const impact = impactResult.value;

      // Display impact summary
      console.log("\n📊 Impact Analysis:");
      console.log(`   Files to modify: ${impact.filesToModify.length}`);
      console.log(
        `   Cross-package dependencies: ${impact.crossPackageDeps.length}`,
      );

      if (impact.warnings.length > 0) {
        console.log("\n⚠️  Warnings:");
        impact.warnings.forEach((warning) => console.log(`   - ${warning}`));
      }

      console.log("\n📝 Files to modify:");
      impact.filesToModify.forEach((file) => {
        console.log(`   ${file.path}`);
        console.log(`      ${file.reason}`);
      });

      if (options.dryRun) {
        console.log("\n✅ Dry run complete. No changes applied.");
        return;
      }

      // Confirm before proceeding
      console.log(
        "\n⚠️  This will modify the files listed above. Continue? (y/N)",
      );
      const readline = await import("node:readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question("", resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== "y") {
        console.log("❌ Refactoring cancelled.");
        return;
      }

      console.log("\n🔧 Executing refactoring...");
      const orchestrator = new SafeRefactoringOrchestrator(
        workspaceRoot,
        manifest,
      );

      const config = options.skipValidation
        ? SafeRefactoringOrchestrator.getFastConfig()
        : SafeRefactoringOrchestrator.getDefaultConfig();

      config.autoCommit = options.autoCommit ?? true;

      const result = await orchestrator.executeWithValidation(
        {
          type: "rename-entity",
          target: currentName,
          newName,
        },
        config,
      );

      if (!result.success) {
        console.error("\n❌ Refactoring failed:", result.error.message);
        process.exit(1);
      }

      const refactoringResult = result.value;

      console.log("\n✅ Refactoring complete!");
      console.log(
        `   Files modified: ${refactoringResult.filesModified.length}`,
      );

      if (refactoringResult.warnings.length > 0) {
        console.log("\n⚠️  Warnings:");
        refactoringResult.warnings.forEach((warning) =>
          console.log(`   - ${warning}`),
        );
      }

      if (config.autoCommit) {
        console.log("\n✅ Changes committed to git.");
      } else {
        console.log("\n⚠️  Changes not committed. Review and commit manually.");
      }
    } catch (error) {
      console.error(
        "\n❌ Fatal error:",
        error instanceof Error ? error.message : String(error),
      );
      process.exit(1);
    }
  });

/**
 * Analyze impact command (dry-run only)
 */
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

      // Display detailed impact analysis
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

// Made with Bob
