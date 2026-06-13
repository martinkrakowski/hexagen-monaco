import { Command } from "commander";
import { manifestSplitCommander } from "./split.js";
import { manifestMigrateCommander } from "./migrate.js";

export const manifestCommander = new Command("manifest").description(
  "Manage the architecture manifest lifecycle",
);

manifestCommander.addCommand(manifestSplitCommander);
manifestCommander.addCommand(manifestMigrateCommander);
