import { loadManifest } from "../../manifest-service.js";
import type { Manifest, BoundedContext, App } from "../../types/manifest.js";
import { getProjectRoot } from "../shared/project-root.js";

export async function listCommand(): Promise<void> {
  const workspaceRoot = getProjectRoot();

  const result = await loadManifest(workspaceRoot);

  if (!result.success) {
    console.error(`Failed to load manifest: ${result.error.message}`);
    process.exit(1);
  }

  const manifest: Manifest = result.value;

  console.log("\n📦 Bounded Contexts\n");

  const contexts: BoundedContext[] =
    (manifest.boundedContexts as BoundedContext[]) ||
    (manifest.bounded_contexts as BoundedContext[]) ||
    [];

  if (contexts.length === 0) {
    console.log("  (no bounded contexts defined)\n");
    return;
  }

  for (const ctx of contexts) {
    console.log(`  ${ctx.name}`);
    if (ctx.type) {
      console.log(`    type: ${ctx.type}`);
    }
    if (ctx.description) {
      console.log(`    description: ${ctx.description}`);
    }

    const layers = ctx.layers || {};
    const layerNames = Object.keys(layers).filter((key) => {
      const layer = layers[key as keyof typeof layers];
      return (
        layer && typeof layer === "object" && Object.keys(layer).length > 0
      );
    });

    if (layerNames.length > 0) {
      console.log(`    layers: ${layerNames.join(", ")}`);
    }

    if (ctx.depends_on && ctx.depends_on.length > 0) {
      console.log(`    depends on: ${ctx.depends_on.join(", ")}`);
    }

    console.log("");
  }

  const apps: App[] = manifest.apps || [];
  if (apps.length > 0) {
    console.log("📱 Applications\n");
    for (const app of apps) {
      console.log(`  ${app.name}`);
      if (app.driver) {
        console.log(`    driver: ${app.driver}`);
      }
    }
    console.log("");
  }
}
