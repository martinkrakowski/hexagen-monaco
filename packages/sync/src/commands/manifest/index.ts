import { Command } from "commander";
import { manifestSplitCommander } from "./split.js";

export const manifestCommander = new Command("manifest").description(
  "Manage the architecture manifest lifecycle",
);

manifestCommander.addCommand(manifestSplitCommander);
