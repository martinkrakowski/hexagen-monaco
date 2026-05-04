/* eslint-disable no-console */
import { ImpactAnalyzer } from "../../refactoring/impact-analyzer.js";
import { SafeRefactoringOrchestrator } from "../../refactoring/safe-refactoring-orchestrator.js";
import { loadManifest } from "../../manifest-service.js";
import type { ImpactAnalysisResult } from "../../refactoring/impact-analyzer.js";
import type { Manifest } from "../../types/manifest.js";
import type { ImpactAnalysisRequest } from "../../refactoring/impact-analyzer.js";

export async function confirmPrompt(): Promise<boolean> {
  console.log("\n⚠️  This will modify the files listed above. Continue? (y/N)");
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question("", resolve);
  });
  rl.close();

  return answer.toLowerCase() === "y";
}

export async function displayImpactSummary(
  impact: ImpactAnalysisResult,
): Promise<void> {
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
}

export interface RunRefactoringOptions {
  dryRun?: boolean;
  skipValidation?: boolean;
  autoCommit?: boolean;
}

export async function runRefactoring(
  request: ImpactAnalysisRequest,
  options: RunRefactoringOptions,
): Promise<void> {
  const workspaceRoot = process.cwd();

  console.log("\n🔍 Loading manifest...");
  const manifestResult = await loadManifest(workspaceRoot);

  if (!manifestResult.success) {
    console.error("❌ Failed to load manifest:", manifestResult.error.message);
    process.exit(1);
  }

  const manifest = manifestResult.value;

  console.log("🔍 Analyzing impact...");
  const analyzer = new ImpactAnalyzer(workspaceRoot, manifest);
  const impactResult = await analyzer.analyze(request);

  if (!impactResult.success) {
    console.error("❌ Impact analysis failed:", impactResult.error.message);
    process.exit(1);
  }

  const impact = impactResult.value;

  await displayImpactSummary(impact);

  if (options.dryRun) {
    console.log("\n✅ Dry run complete. No changes applied.");
    return;
  }

  const confirmed = await confirmPrompt();
  if (!confirmed) {
    console.log("❌ Refactoring cancelled.");
    return;
  }

  await executeRefactoring(workspaceRoot, manifest, request, options);
}

async function executeRefactoring(
  workspaceRoot: string,
  manifest: Manifest,
  request: ImpactAnalysisRequest,
  options: RunRefactoringOptions,
): Promise<void> {
  console.log("\n🔧 Executing refactoring...");
  const orchestrator = new SafeRefactoringOrchestrator(workspaceRoot, manifest);

  const config = options.skipValidation
    ? SafeRefactoringOrchestrator.getFastConfig()
    : SafeRefactoringOrchestrator.getDefaultConfig();

  config.autoCommit = options.autoCommit ?? true;

  const result = await orchestrator.executeWithValidation(request, config);

  if (!result.success) {
    console.error("\n❌ Refactoring failed:", result.error.message);
    process.exit(1);
  }

  const refactoringResult = result.value;

  console.log("\n✅ Refactoring complete!");
  console.log(`   Files modified: ${refactoringResult.filesModified.length}`);

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
}
