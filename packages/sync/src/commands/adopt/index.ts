/* eslint-disable no-console */
import { Command } from "commander";
import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { err, ok, type Result } from "../../domain/result.js";
import { detectWorkspaces } from "../shared/detect-workspaces.js";

export interface AdoptOptions {
  root: string;
  yes?: boolean;
  dryRun?: boolean;
  invokeLint?: boolean;
  force?: boolean;
}

export interface AdoptResult {
  layoutPath: string;
  wrote: boolean;
  nextSteps: string[];
}

function serializeLayout(
  detection: Awaited<ReturnType<typeof detectWorkspaces>>,
): string {
  const contexts: Record<
    string,
    { root: string; layers?: Record<string, string[]> }
  > = {};
  for (const pkg of detection.packages) {
    const entry: { root: string; layers?: Record<string, string[]> } = {
      root: pkg.root,
    };
    if (Object.keys(pkg.layers).length > 0) {
      entry.layers = { ...pkg.layers } as Record<string, string[]>;
    }
    contexts[pkg.name] = entry;
  }
  return yaml.dump({ contexts }, { indent: 2, lineWidth: 100, noRefs: true });
}

export async function runAdopt(
  options: AdoptOptions,
): Promise<Result<AdoptResult, Error>> {
  try {
    const detection = await detectWorkspaces(options.root);
    if (detection.packages.length === 0) {
      return err(
        new Error(
          "No workspace packages found. Add workspaces to package.json or pass a repo that contains packages.",
        ),
      );
    }

    const contents = serializeLayout(detection);
    const layoutPath = path.join(options.root, ".architecture", "layout.yaml");

    if (options.dryRun === true) {
      return ok({
        layoutPath,
        wrote: false,
        nextSteps: ["Dry-run: layout.yaml was not written.", contents],
      });
    }

    if (options.yes !== true) {
      return err(
        new Error(
          "Refusing to write layout.yaml without ratification. Re-run with --yes, or pass --dry-run to preview.",
        ),
      );
    }

    await fs.mkdir(path.dirname(layoutPath), { recursive: true });

    const exists = await fs
      .stat(layoutPath)
      .then(() => true)
      .catch(() => false);

    if (exists && options.force !== true) {
      return err(
        new Error(
          `Refusing to overwrite existing ${layoutPath}. Pass --force to overwrite.`,
        ),
      );
    }

    await fs.writeFile(layoutPath, contents, "utf8");

    const hasManifest = await fs
      .stat(path.join(options.root, ".architecture", "manifest.yaml"))
      .then(() => true)
      .catch(() => false);

    const nextSteps = [
      `Wrote ${path.relative(options.root, layoutPath) || ".architecture/layout.yaml"}.`,
      hasManifest
        ? "Run `hexagen-lint --root .` to produce a first report (vacuous runs exit 2)."
        : "No manifest yet — run `hexagen bootstrap --yes` (or answer its questions) before linting.",
    ];
    if (options.invokeLint === true) {
      nextSteps.push(
        "hexagen-lint --root .   # layout.yaml is now the directory map",
      );
    }

    return ok({ layoutPath, wrote: true, nextSteps });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

export async function adoptCommand(options: {
  root?: string;
  yes?: boolean;
  dryRun?: boolean;
  invokeLint?: boolean;
}): Promise<void> {
  const result = await runAdopt({
    root: path.resolve(options.root ?? process.cwd()),
    yes: options.yes,
    dryRun: options.dryRun,
    invokeLint: options.invokeLint,
  });
  if (!result.success) {
    console.error(`❌ ${result.error.message}`);
    process.exitCode = 1;
    return;
  }
  for (const line of result.value.nextSteps) {
    console.log(line);
  }
}

export const adoptCommander = new Command("adopt")
  .description(
    "Write .architecture/layout.yaml mapping this repo's directories onto Hexagen contexts and layers",
  )
  .option("--root <path>", "Project root (defaults to cwd)")
  .option("--yes", "Accept detected mappings without prompting")
  .option("--dry-run", "Print the proposed layout.yaml without writing")
  .option("--force", "Overwrite existing layout.yaml")
  .option(
    "--invoke-lint",
    "Print the hexagen-lint invocation to run after writing layout.yaml",
  )
  .action(
    async (opts: {
      root?: string;
      yes?: boolean;
      dryRun?: boolean;
      invokeLint?: boolean;
      force?: boolean;
    }) => {
      await adoptCommand(opts);
    },
  );
