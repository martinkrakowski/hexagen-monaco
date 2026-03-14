import { Command } from "commander";
import { removePortCommander, type RemovePortOptions } from "./remove/port.js";
import {
  removeContextCommander,
  type RemoveContextOptions,
} from "./remove/context.js";

export const removeCommander = new Command("remove")
  .description("Remove a port or bounded context from manifest.yaml")
  .option("--force", "Skip confirmation prompts (for scripting)")
  .addCommand(removePortCommander)
  .addCommand(removeContextCommander)
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.opts();
    (removePortCommander as any).forceOption = opts.force;
    (removeContextCommander as any).forceOption = opts.force;
  });
