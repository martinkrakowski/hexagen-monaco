/* eslint-disable no-console */
import { Command } from "commander";
import { runEvidencePack } from "./pack.js";

export const evidenceCommander = new Command("evidence").description(
  "Verify and pack trace evidence (docs/kernel/TRACE.md)",
);

evidenceCommander
  .command("pack <trace>")
  .description(
    "Verify a brownfield trace (hash chain, anchored tip, grant rules) and write an HMAC'd bundle under .hexagen/. Exits non-zero, writing nothing, on any invalid line",
  )
  .requiredOption(
    "--grant <file...>",
    "Grant file(s) the trace's lines cite (repeatable)",
  )
  .requiredOption(
    "--out <zip>",
    "Bundle path; must resolve under <root>/.hexagen/",
  )
  .option("--root <dir>", "Repo root (defaults to cwd; never searched upward)")
  .option("--key-file <path>", "Engagement key file")
  .option("--engagement <id>", "Engagement id (defaults to the slice id)")
  .action(
    async (
      trace: string,
      opts: {
        grant: string[];
        out: string;
        root?: string;
        keyFile?: string;
        engagement?: string;
      },
    ) => {
      const result = await runEvidencePack({
        root: opts.root ?? process.cwd(),
        trace,
        grantFiles: opts.grant,
        out: opts.out,
        keyFile: opts.keyFile,
        engagement: opts.engagement,
      });
      for (const line of result.messages) console.error(line);
      process.exitCode = result.exitCode;
    },
  );
