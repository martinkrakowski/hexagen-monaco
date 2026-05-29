/* eslint-disable no-console */
import {
  FileSystemTemplateRegistry,
  FileSystemTemplateConfigStore,
} from "@hexagen/template-engine";
import { getProjectRoot, resolveTemplatesDir } from "../shared/index.js";

export async function listTemplatesCommand(): Promise<void> {
  const registry = new FileSystemTemplateRegistry(resolveTemplatesDir());
  const all = await registry.loadAll();

  if (all.length === 0) {
    console.log("No templates found in registry.");
    return;
  }

  // Check which are installed (best-effort — no project root required)
  let installed = new Set<string>();
  try {
    const root = getProjectRoot();
    const store = new FileSystemTemplateConfigStore();
    const config = await store.load(root);
    installed = new Set(Object.keys(config.templates));
  } catch {
    // Not in a project — still show the list
  }

  console.log(`\nAvailable templates (${all.length}):\n`);

  for (const m of all) {
    if (m.id.startsWith("__")) continue; // hide internal templates
    const status = installed.has(m.id) ? " ✅" : "   ";
    const requires =
      m.requires.length > 0 ? `  [requires: ${m.requires.join(", ")}]` : "";
    const version = `v${m.version}`.padEnd(8);
    const id = m.id.padEnd(22);
    console.log(`${status} ${id} ${version} ${m.description}${requires}`);
  }

  console.log("");
  console.log("  ✅ = already installed in this project");
  console.log("  Run: hexagen add <id> to apply a template");
  console.log("");
}
