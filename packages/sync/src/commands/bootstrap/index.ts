/* eslint-disable no-console */
import { Command } from "commander";
import { promises as fs } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { err, ok, type Result } from "../../domain/result.js";
import { detectWorkspaces } from "../shared/detect-workspaces.js";
import { promptService } from "../shared/prompt-service.js";

export interface BootstrapContextAnswer {
  name: string;
  include: boolean;
  type?: string;
  root: string;
  description?: string;
  dependsOn?: string[];
}

export interface BootstrapAnswers {
  system?: string;
  scope?: string;
  architecture?: string;
  contexts: BootstrapContextAnswer[];
}

export interface BootstrapOptions {
  root: string;
  yes?: boolean;
  answersPath?: string;
  stdinJson?: boolean;
  llm?: boolean;
  dryRun?: boolean;
  force?: boolean;
}

export interface BootstrapResult {
  files: string[];
  wrote: boolean;
}

const EMPTY_BASELINE = `{
  "version": 1,
  "entries": []
}
`;

function sanitizeScope(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/[._-]{2,}/g, "-")
    .slice(0, 214)
    .replace(/^[._-]+|[._-]+$/g, "");
  return cleaned.length > 0 ? cleaned : "generated-project";
}

async function readAnswers(
  options: BootstrapOptions,
): Promise<Result<BootstrapAnswers | null, Error>> {
  if (options.answersPath) {
    try {
      const raw = await fs.readFile(options.answersPath, "utf8");
      return ok(JSON.parse(raw) as BootstrapAnswers);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
  if (options.stdinJson === true) {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (raw.length === 0) {
        return err(new Error("--stdin-json was set but stdin was empty"));
      }
      return ok(JSON.parse(raw) as BootstrapAnswers);
    } catch (e) {
      return err(e instanceof Error ? e : new Error(String(e)));
    }
  }
  return ok(null);
}

async function proposeAnswers(
  root: string,
  yes: boolean,
): Promise<Result<BootstrapAnswers, Error>> {
  const detection = await detectWorkspaces(root);
  if (detection.packages.length === 0) {
    return err(
      new Error("No workspace packages found to propose as contexts."),
    );
  }

  if (yes) {
    return ok({
      system: detection.system,
      scope: sanitizeScope(detection.system),
      architecture: "modular-monolith",
      contexts: detection.packages.map((pkg) => ({
        name: pkg.name,
        include: true,
        type: "core",
        root: pkg.root,
        description: `Candidate context from ${pkg.root}`,
      })),
    });
  }

  if (!promptService.canPrompt()) {
    return err(
      new Error(
        "Refusing to write a guessed manifest without ratification. Re-run with --yes, --answers <file>, or --stdin-json.",
      ),
    );
  }

  try {
    console.log(
      "These are proposed contexts, not assertions. Include only what you ratify.",
    );
    const system = await promptService.ask(
      `System name [${detection.system}]: `,
    );
    const scopeDefault = sanitizeScope(system || detection.system);
    const scope = await promptService.ask(`npm scope [${scopeDefault}]: `);
    const contexts: BootstrapContextAnswer[] = [];
    for (const pkg of detection.packages) {
      const include = await promptService.ask(
        `Include '${pkg.name}' (root ${pkg.root}) as a bounded context? [y/N]: `,
      );
      if (!["y", "yes"].includes(include.toLowerCase())) continue;
      const rename = await promptService.ask(`  Name [${pkg.name}]: `);
      const type = await promptService.ask(`  Type [core]: `);
      contexts.push({
        name: rename || pkg.name,
        include: true,
        type: type || "core",
        root: pkg.root,
        description: `Ratified from ${pkg.root}`,
      });
    }
    return ok({
      system: system || detection.system,
      scope: sanitizeScope(scope || scopeDefault),
      architecture: "modular-monolith",
      contexts,
    });
  } finally {
    promptService.close();
  }
}

function emitManifest(answers: BootstrapAnswers): string {
  return yaml.dump(
    {
      system: answers.system ?? "app",
      scope: sanitizeScope(answers.scope ?? answers.system ?? "app"),
      architecture: answers.architecture ?? "modular-monolith",
      bounded_contexts: answers.contexts
        .filter((c) => c.include)
        .map((c) => ({
          name: c.name,
          type: c.type ?? "core",
          description: c.description ?? "",
          ...(c.dependsOn && c.dependsOn.length > 0
            ? { depends_on: c.dependsOn }
            : {}),
          layers: {
            domain: {},
            application: {},
            infrastructure: {},
          },
        })),
    },
    { indent: 2, lineWidth: 100, noRefs: true },
  );
}

function emitLayout(
  answers: BootstrapAnswers,
  detected: Awaited<ReturnType<typeof detectWorkspaces>>,
): string {
  const byName = new Map(detected.packages.map((p) => [p.name, p]));
  const byRoot = new Map(detected.packages.map((p) => [p.root, p]));
  const contexts: Record<
    string,
    { root: string; layers?: Record<string, string[]> }
  > = {};
  for (const ctx of answers.contexts.filter((c) => c.include)) {
    const detectedPkg = byName.get(ctx.name) ?? byRoot.get(ctx.root);
    const entry: { root: string; layers?: Record<string, string[]> } = {
      root: ctx.root,
    };
    if (detectedPkg && Object.keys(detectedPkg.layers).length > 0) {
      entry.layers = { ...detectedPkg.layers } as Record<string, string[]>;
    }
    contexts[ctx.name] = entry;
  }
  return yaml.dump({ contexts }, { indent: 2, lineWidth: 100, noRefs: true });
}

export async function runBootstrap(
  options: BootstrapOptions,
): Promise<Result<BootstrapResult, Error>> {
  try {
    if (options.llm === true) {
      return err(
        new Error(
          "hexagen bootstrap --llm is not wired yet. Run without --llm for the deterministic, question-driven path.",
        ),
      );
    }

    const loaded = await readAnswers(options);
    if (!loaded.success) return loaded;

    let answers = loaded.value;
    if (!answers) {
      const proposed = await proposeAnswers(options.root, options.yes === true);
      if (!proposed.success) return proposed;
      answers = proposed.value;
    }

    const included = answers.contexts.filter((c) => c.include);
    if (included.length === 0) {
      return err(
        new Error(
          "No contexts were ratified. Nothing was written. Re-run and include at least one candidate.",
        ),
      );
    }

    const detection = await detectWorkspaces(options.root);
    const archDir = path.join(options.root, ".architecture");
    const files = [
      path.join(archDir, "manifest.yaml"),
      path.join(archDir, "layout.yaml"),
      path.join(archDir, "arch-lint-baseline.json"),
    ];

    if (options.dryRun === true) {
      return ok({ files, wrote: false });
    }

    if (options.force !== true) {
      const blockers: string[] = [];
      for (const file of files) {
        try {
          await fs.stat(file);
        } catch {
          continue;
        }
        if (path.basename(file) === "arch-lint-baseline.json") {
          try {
            const parsed = JSON.parse(await fs.readFile(file, "utf8")) as {
              entries?: unknown[];
            };
            if (Array.isArray(parsed.entries) && parsed.entries.length > 0) {
              blockers.push(file);
            }
            continue;
          } catch {
            blockers.push(file);
            continue;
          }
        }
        blockers.push(file);
      }
      if (blockers.length > 0) {
        return err(
          new Error(
            `Refusing to overwrite existing architecture files (including a populated ratchet baseline). Re-run with --force to replace:\n${blockers.map((b) => `  ${b}`).join("\n")}`,
          ),
        );
      }
    }

    await fs.mkdir(archDir, { recursive: true });
    for (const [i, content] of [
      emitManifest(answers),
      emitLayout(answers, detection),
      EMPTY_BASELINE,
    ].entries()) {
      await fs.writeFile(`${files[i]}.tmp`, content, "utf8");
    }
    for (const f of files) {
      await fs.rename(`${f}.tmp`, f);
    }
    return ok({ files, wrote: true });
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}

export async function bootstrapCommand(options: {
  root?: string;
  yes?: boolean;
  answers?: string;
  stdinJson?: boolean;
  llm?: boolean;
  dryRun?: boolean;
  force?: boolean;
}): Promise<void> {
  const result = await runBootstrap({
    root: path.resolve(options.root ?? process.cwd()),
    yes: options.yes,
    answersPath: options.answers,
    stdinJson: options.stdinJson,
    llm: options.llm,
    dryRun: options.dryRun,
    force: options.force,
  });
  if (!result.success) {
    console.error(`❌ ${result.error.message}`);
    process.exitCode = 1;
    return;
  }
  if (result.value.wrote) {
    console.log("Wrote:");
    for (const file of result.value.files) {
      console.log(`  ${file}`);
    }
    console.log(
      "These files are ratified starting points, not inferred truth. Review them, then run hexagen-lint.",
    );
    return;
  }
  console.log("Would write:");
  for (const file of result.value.files) {
    console.log(`  ${file}`);
  }
  console.log("Dry-run: no files were written.");
}

export const bootstrapCommander = new Command("bootstrap")
  .description(
    "Propose candidate bounded contexts as questions and emit manifest.yaml + layout.yaml + arch-lint-baseline.json after ratification",
  )
  .option("--root <path>", "Project root (defaults to cwd)")
  .option("--yes", "Accept every detected candidate (for tests / CI)")
  .option(
    "--answers <file>",
    "JSON answers file (deterministic, non-interactive)",
  )
  .option("--stdin-json", "Read the same JSON answers document from stdin")
  .option("--llm", "Reserved — not wired yet")
  .option("--dry-run", "Resolve answers without writing files")
  .option("--force", "Overwrite existing manifest, layout, or baseline files")
  .action(
    async (opts: {
      root?: string;
      yes?: boolean;
      answers?: string;
      stdinJson?: boolean;
      llm?: boolean;
      dryRun?: boolean;
      force?: boolean;
    }) => {
      await bootstrapCommand(opts);
    },
  );
