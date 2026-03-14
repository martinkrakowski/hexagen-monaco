import { Command } from "commander";

export const addCommand = new Command("add").description(
  "Add new architecture elements (ports, contexts, etc.)",
);

// Register subcommands dynamically to avoid circular dependencies
// This allows the CLI registration in cli.ts to import and attach port command
