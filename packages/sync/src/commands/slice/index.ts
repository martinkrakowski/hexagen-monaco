import { randomBytes } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  BROWNFIELD_SCHEMA_VERSION,
  Slice,
  edgesComplete,
  isPathInSlice,
  normalizeSlicePath,
} from "@hexagen/shared";
import { isValidEngagementId } from "@hexagen/shared/node/grant-key";
import { readRepo } from "../observe/index.js";
import { ensureExcluded } from "../shared/git-exclude.js";
import { resolveSidecarOut } from "../shared/sidecar-out.js";
import {
  SidecarFileExistsError,
  writeFileExclusive,
} from "../shared/sidecar-write.js";
import {
  UsageError,
  asResult,
  changedSince,
  git,
  listWorkTreeFiles,
  loadObserved,
  loadSlice,
  preflight,
  staleInputs,
  targetInSlice,
  underPrefix,
  type CommandResult,
} from "../shared/brownfield-sidecar.js";

export interface SliceRootOptions {
  /** Repo top level; the CLI defaults it to cwd and never searches upward. */
  root: string;
}

export interface SliceInitOptions extends SliceRootOptions {
  paths: string[];
  exclude?: string[];
  id?: string;
  by?: string;
  yes?: boolean;
}

async function exists(file: string): Promise<boolean> {
  return lstat(file).then(
    () => true,
    () => false,
  );
}

export async function runSliceInit(
  options: SliceInitOptions,
): Promise<CommandResult> {
  const messages: string[] = [];
  try {
    const root = path.resolve(options.root);
    const paths = options.paths;
    const excludes = options.exclude ?? [];
    if (paths.length === 0) throw new UsageError("--path is required");
    for (const [flag, list] of [
      ["--path", paths],
      ["--exclude", excludes],
    ] as const) {
      for (const entry of list) {
        const check = normalizeSlicePath(entry);
        if (!check.ok) {
          throw new UsageError(`${flag} "${entry}": ${check.reason}`);
        }
      }
    }
    const id = options.id ?? `slice-${randomBytes(4).toString("hex")}`;
    if (!isValidEngagementId(id)) {
      throw new UsageError(
        `invalid --id "${id}": use A-Z a-z 0-9 . _ - (1-64 chars, no "..")`,
      );
    }
    const repo = readRepo(root);
    const by = options.by ?? git(root, ["config", "user.email"])?.trim();
    if (!by) {
      throw new UsageError(
        "cannot tell who is creating the slice: pass --by or set git config user.email",
      );
    }
    const target = await resolveSidecarOut(root, ".hexagen/slice.json");
    if (!target) throw new UsageError(".hexagen/slice.json is not writable");
    const slice = Slice.parse({
      schemaVersion: BROWNFIELD_SCHEMA_VERSION,
      id,
      repo,
      paths,
      excludes,
      createdBy: by,
      createdAt: new Date().toISOString(),
    });
    // Refuse before the preflight so an existing slice is never "planned".
    if (await exists(target)) {
      throw new SidecarFileExistsError(
        `${target} already exists; refusing to overwrite a slice`,
      );
    }
    const { applyExclude } = await preflight(
      root,
      [target],
      options.yes,
      messages,
    );
    // The exclude is updated first: if it fails, no slice.json exists.
    if (applyExclude) await ensureExcluded(root, ".hexagen/");
    await writeFileExclusive(target, `${JSON.stringify(slice, null, 2)}\n`);
    messages.push(`wrote ${target} (id: ${slice.id})`);
    return { exitCode: 0, messages };
  } catch (e) {
    return asResult(e, messages);
  }
}

export async function runSliceShow(
  options: SliceRootOptions,
): Promise<CommandResult> {
  const messages: string[] = [];
  try {
    const slice = await loadSlice(path.resolve(options.root));
    return {
      exitCode: 0,
      messages,
      stdout: `${JSON.stringify(slice, null, 2)}\n`,
    };
  } catch (e) {
    return asResult(e, messages);
  }
}

export interface SliceCheckOptions extends SliceRootOptions {
  strict?: boolean;
  /** Fail (exit 1) on edges that cross the slice boundary. */
  closed?: boolean;
}

export async function runSliceCheck(
  options: SliceCheckOptions,
): Promise<CommandResult> {
  const messages: string[] = [];
  try {
    const root = path.resolve(options.root);
    const slice = await loadSlice(root);
    const observed = await loadObserved(root);
    const stale = staleInputs(root, slice, observed, options.strict === true);
    messages.push(...stale.warnings);
    if (stale.problems.length > 0) {
      messages.push(...stale.problems);
      return { exitCode: 2, messages };
    }

    const drift: string[] = [];
    const notes: string[] = [];
    const crossings: string[] = [];

    const files = listWorkTreeFiles(root);
    for (const entry of slice.paths) {
      if (!files.some((f) => underPrefix(entry, f))) {
        drift.push(`path "${entry}" matches no files`);
      }
    }
    for (const entry of slice.excludes) {
      if (!files.some((f) => underPrefix(entry, f))) {
        notes.push(
          `note: exclude "${entry}" matches no files (gitignored generated directories never appear)`,
        );
      }
    }

    const changed = changedSince(root, slice.repo.commit, slice.paths);
    if (changed === null) {
      throw new UsageError(
        `git diff ${slice.repo.commit}..HEAD failed; cannot tell what changed`,
      );
    }
    for (const f of changed.filter((f) => isPathInSlice(slice, f))) {
      drift.push(`changed since ${slice.repo.commit.slice(0, 12)}: ${f}`);
    }

    const edges = observed.edges;
    if (!edgesComplete(edges)) {
      drift.push(
        edges.collected
          ? `edges are incomplete: the import pass did not read ${edges.unreadLanguages.join(", ")} files, so boundary crossings cannot be ruled out`
          : `edges are incomplete: not collected (${edges.reason}), so boundary crossings cannot be ruled out`,
      );
    }
    if (edges.collected) {
      for (const e of edges.items) {
        const fromIn = isPathInSlice(slice, e.from);
        const toIn = targetInSlice(slice, e.to);
        if (fromIn && !toIn) {
          crossings.push(`leaves: ${e.from} -> ${e.to} (${e.specifier})`);
        } else if (!fromIn && toIn) {
          crossings.push(`enters: ${e.from} -> ${e.to} (${e.specifier})`);
        }
      }
    }

    messages.push(...notes);
    const closedFail = options.closed === true && crossings.length > 0;
    const leaving = crossings.filter((c) => c.startsWith("leaves")).length;
    const lines: string[] = [];
    if (drift.length > 0) lines.push(...drift.map((d) => `  - drift: ${d}`));
    if (crossings.length > 0) {
      lines.push(
        `  boundary edges (${leaving} leaving, ${crossings.length - leaving} entering; fail only with --closed):`,
        ...crossings.map((c) => `    ${c}`),
      );
    }
    const failed = drift.length > 0 || closedFail;
    if (!failed) {
      messages.push(`slice ${slice.id}: clean`);
    }
    return {
      exitCode: failed ? 1 : 0,
      messages,
      ...(lines.length > 0
        ? { stdout: `slice ${slice.id}:\n${lines.join("\n")}\n` }
        : {}),
    };
  } catch (e) {
    return asResult(e, messages);
  }
}

function emit(result: CommandResult): void {
  for (const line of result.messages) console.error(line);
  if (result.stdout !== undefined) process.stdout.write(result.stdout);
  process.exitCode = result.exitCode;
}

const ROOT_FLAG = "--root <dir>";
const ROOT_DESC = "Repo top level (defaults to cwd; never searched upward)";

export const sliceCommander = new Command("slice").description(
  "Bind work to a slice of a repo you do not control: .hexagen/slice.json",
);

sliceCommander
  .command("init")
  .description("Write .hexagen/slice.json (never overwrites; requires --yes)")
  .requiredOption(
    "--path <path...>",
    "Repo-relative path or directory prefix (trailing /) inside the slice",
  )
  .option("--exclude <path...>", "Repo-relative paths denied inside the slice")
  .option(
    "--id <id>",
    "Slice id (A-Z a-z 0-9 . _ -, 1-64 chars); random by default",
  )
  .option("--by <who>", "createdBy; defaults to git config user.email")
  .option(ROOT_FLAG, ROOT_DESC)
  .option("--yes", "Confirm the writes listed by the `will write:` lines")
  .action(
    async (opts: {
      path: string[];
      exclude?: string[];
      id?: string;
      by?: string;
      root?: string;
      yes?: boolean;
    }) => {
      emit(
        await runSliceInit({
          root: opts.root ?? process.cwd(),
          paths: opts.path,
          exclude: opts.exclude,
          id: opts.id,
          by: opts.by,
          yes: opts.yes,
        }),
      );
    },
  );

sliceCommander
  .command("show")
  .description("Print .hexagen/slice.json")
  .option(ROOT_FLAG, ROOT_DESC)
  .action(async (opts: { root?: string }) => {
    emit(await runSliceShow({ root: opts.root ?? process.cwd() }));
  });

sliceCommander
  .command("check")
  .description(
    "Report slice drift. Exit 0 clean, 1 drift, 2 bad input or stale observed.json",
  )
  .option("--strict", "Fail (exit 2) when observed.json was not read at HEAD")
  .option("--closed", "Also fail (exit 1) on edges crossing the slice boundary")
  .option(ROOT_FLAG, ROOT_DESC)
  .action(
    async (opts: { root?: string; strict?: boolean; closed?: boolean }) => {
      emit(
        await runSliceCheck({
          root: opts.root ?? process.cwd(),
          strict: opts.strict,
          closed: opts.closed,
        }),
      );
    },
  );
