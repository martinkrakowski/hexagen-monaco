import { Command } from "commander";
import { removePortCommander } from "./remove/port.js";
import { removeContextCommander } from "./remove/context.js";

export const removeCommander = new Command("remove")
  .description("Remove a port or bounded context from manifest.yaml")
  .option("--force", "Skip confirmation prompts (for scripting)")
  .addCommand(removePortCommander)
  .addCommand(removeContextCommander);
