import { validateManifest } from "../../manifest-service.js";

export async function validateCommand(): Promise<void> {
  const workspaceRoot = process.cwd();

  console.log("Running architecture validation...\n");

  const result = await validateManifest(workspaceRoot);

  if (!result.success) {
    console.error(`❌ Validation service failed: ${result.error.message}`);
    process.exit(1);
  }

  if (!result.value.valid) {
    console.warn("⚠️  Architecture violations detected:\n");
    result.value.errors.forEach((err, i) => {
      console.warn(`  ${i + 1}. ${err}`);
    });
    console.log("");
    process.exit(1);
  }

  console.log("✅ Architecture is compliant with manifest.yaml");
}
