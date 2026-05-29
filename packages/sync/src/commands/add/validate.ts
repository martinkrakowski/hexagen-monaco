/* eslint-disable no-console */
import {
  FileSystemTemplateRegistry,
  FileSystemTemplateConfigStore,
  ValidateTemplatesUseCase,
} from "@hexagen/template-engine";
import { getProjectRoot, resolveTemplatesDir } from "../shared/index.js";

export async function validateTemplatesCommand(): Promise<void> {
  const projectRoot = getProjectRoot();
  const registry = new FileSystemTemplateRegistry(resolveTemplatesDir());
  const configStore = new FileSystemTemplateConfigStore();

  const useCase = new ValidateTemplatesUseCase(registry, configStore);
  const output = await useCase.execute(projectRoot);

  if (output.results.length === 0) {
    console.log("\n  No templates installed in this project.");
    console.log("  Run: hexagen templates list  to see available templates\n");
    return;
  }

  const installed = output.results.map((r) => r.templateId).join(", ");
  console.log(`\nInstalled templates: ${installed}\n`);

  for (const result of output.results) {
    const icon =
      result.passed && result.missingEnvVars.length === 0
        ? "✅"
        : result.passed
          ? "⚠️ "
          : "❌";
    console.log(`${icon} ${result.templateId}`);

    for (const file of result.missingFiles) {
      console.log(`   ❌ Missing: ${file}`);
    }
    for (const envVar of result.missingEnvVars) {
      console.log(`   ⚠️  Env var not set: ${envVar}`);
    }
    for (const conflict of result.conflictFiles) {
      console.log(`   ⚠️  Unresolved conflict: ${conflict}`);
    }
    if (
      result.passed &&
      result.missingEnvVars.length === 0 &&
      result.conflictFiles.length === 0
    ) {
      console.log(`   All output files present, no conflicts`);
    }
  }

  const summary: string[] = [];
  if (output.totalErrors > 0) summary.push(`${output.totalErrors} error(s)`);
  if (output.totalWarnings > 0)
    summary.push(`${output.totalWarnings} warning(s)`);

  console.log("");
  if (summary.length === 0) {
    console.log("✅ All templates pass validation.\n");
  } else {
    console.log(`Found ${summary.join(", ")}.\n`);
    if (output.totalErrors > 0) process.exit(1);
  }
}
