/* eslint-disable no-console */
import { Command } from "commander";
import { runEvidencePack } from "./pack.js";
import { runEvidenceVerify } from "./verify.js";

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

evidenceCommander
  .command("verify")
  .description(
    "Name every changed file in the slice or a grant's paths that no trace line appended after --since covers. Found after the fact, not enforced: it reads only and never stops a write",
  )
  .requiredOption(
    "--since <git-ref>",
    "Lower end of the range; only lines appended after it can cover a change",
  )
  .requiredOption(
    "--grant <file...>",
    "Grant file(s) the trace's lines cite, and whose paths widen scope (repeatable)",
  )
  .option("--until <git-ref>", "Upper end of the range (defaults to HEAD)")
  .option("--root <dir>", "Repo root (defaults to cwd; never searched upward)")
  .option("--key-file <path>", "Engagement key file")
  .option("--engagement <id>", "Engagement id (defaults to the slice id)")
  .option(
    "--allow-empty",
    "Exit 0 on an empty range instead of 2 (nothing was checked)",
  )
  .action(
    async (opts: {
      since: string;
      until?: string;
      grant: string[];
      root?: string;
      keyFile?: string;
      engagement?: string;
      allowEmpty?: boolean;
    }) => {
      const result = await runEvidenceVerify({
        root: opts.root ?? process.cwd(),
        since: opts.since,
        until: opts.until,
        grantFiles: opts.grant,
        keyFile: opts.keyFile,
        engagement: opts.engagement,
        allowEmpty: opts.allowEmpty,
      });
      if (result.stdout) process.stdout.write(result.stdout);
      for (const line of result.messages) console.error(line);
      process.exitCode = result.exitCode;
    },
  );
