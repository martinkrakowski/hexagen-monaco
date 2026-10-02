/* eslint-disable no-console */
import { Command } from "commander";
import { runWorkbookExport } from "./export.js";

export const workbookCommander = new Command("workbook").description(
  "Export the brownfield workbook (.hexagen/) as a bundle, or stage allow-listed files",
);

workbookCommander
  .command("export")
  .description(
    "Write an HMAC'd workbook bundle (observed, slice, contract, grants, proposals, packed evidence, tip) from an allow-list that never includes a key. With --stage, print the diff of allow-listed .hexagen/ files and stage them (git add -f) only with --yes",
  )
  .option(
    "--out <zip>",
    "Bundle path; must resolve under <root>/.hexagen/, not under evidence/; never overwrites",
  )
  .option(
    "--stage <file...>",
    "Allow-listed .hexagen/ files to stage into this repo's history instead of writing a bundle",
  )
  .option("--yes", "With --stage: run git add -f on exactly those files")
  .option("--root <dir>", "Repo root (defaults to cwd; never searched upward)")
  .option("--key-file <path>", "Engagement key file")
  .option("--engagement <id>", "Engagement id (defaults to the slice id)")
  .action(
    async (opts: {
      out?: string;
      stage?: string[];
      yes?: boolean;
      root?: string;
      keyFile?: string;
      engagement?: string;
    }) => {
      const result = await runWorkbookExport({
        root: opts.root ?? process.cwd(),
        out: opts.out,
        stage: opts.stage,
        yes: opts.yes,
        keyFile: opts.keyFile,
        engagement: opts.engagement,
      });
      for (const line of result.messages) console.error(line);
      process.exitCode = result.exitCode;
    },
  );
