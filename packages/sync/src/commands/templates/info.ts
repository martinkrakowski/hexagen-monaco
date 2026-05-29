/* eslint-disable no-console */
import { FileSystemTemplateRegistry } from "@hexagen/template-engine";
import { resolveTemplatesDir } from "../shared/index.js";

export async function templateInfoCommand(id: string): Promise<void> {
  const registry = new FileSystemTemplateRegistry(resolveTemplatesDir());
  const manifest = await registry.loadOne(id);

  if (!manifest) {
    console.error(`❌ Template '${id}' not found in registry.`);
    console.error(`   Run: hexagen templates list  to see available templates`);
    process.exit(1);
  }

  console.log(`\nTemplate: ${manifest.name} (${manifest.id})`);
  console.log(`Version:  v${manifest.version}`);
  console.log(`          ${manifest.description}`);

  if (manifest.branch) {
    console.log(`Branch:   ${manifest.branch}`);
  }

  if (manifest.requires.length > 0) {
    console.log(`Requires: ${manifest.requires.join(", ")}`);
  }
  if (manifest.conflicts.length > 0) {
    console.log(`Conflicts: ${manifest.conflicts.join(", ")}`);
  }

  if (manifest.questions.length > 0) {
    console.log("\nQuestions:");
    for (const q of manifest.questions) {
      if (q.type === "select") {
        const def = q.default ? `  [default: ${q.default}]` : "";
        console.log(`  ${q.id.padEnd(24)} ${q.prompt}`);
        console.log(
          `  ${" ".repeat(24)} options: (${q.options.join(", ")})${def}`,
        );
      } else if (q.type === "multiselect") {
        const def = q.default?.length
          ? `  [default: ${q.default.join(", ")}]`
          : "";
        console.log(`  ${q.id.padEnd(24)} ${q.prompt}`);
        console.log(
          `  ${" ".repeat(24)} options: (${q.options.join(", ")})${def}`,
        );
      } else if (q.type === "auto") {
        console.log(
          `  ${q.id.padEnd(24)} [auto: derived from ${q.derivedFrom}]`,
        );
      } else {
        const def =
          "default" in q && q.default !== undefined
            ? `  [default: ${q.default}]`
            : "";
        console.log(`  ${q.id.padEnd(24)} ${q.prompt}${def}`);
      }
    }
  }

  if (manifest.outputs.length > 0) {
    console.log("\nOutputs:");
    for (const out of manifest.outputs) {
      console.log(`  ${out}`);
    }
  }

  if (manifest.envVars.length > 0) {
    console.log("\nEnvironment Variables:");
    console.log(`  ${manifest.envVars.join(", ")}`);
  }

  if (manifest.checklist.length > 0) {
    console.log("\nPost-Install Checklist:");
    manifest.checklist.forEach((item, i) => {
      console.log(`  ${i + 1}. ${item}`);
    });
  }

  console.log("");
}
