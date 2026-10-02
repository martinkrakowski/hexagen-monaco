/* eslint-disable no-console */
import { randomBytes } from "node:crypto";
import { link, lstat, mkdir, open, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  type Slice,
  isPathInSlice,
  normalizeSlicePath,
  type SlicePaths,
} from "@hexagen/shared";
import {
  describeKeyMismatch,
  isRepoMode,
  readGrantKey,
  resolveGrantKey,
} from "@hexagen/shared/node/grant-key";
import {
  buildGrant,
  deriveContextsFromPaths,
  expandContexts,
  type IssuedGrant,
} from "./build.js";
import {
  GitExcludeError,
  ensureExcluded,
  excludeWouldChange,
} from "../shared/git-exclude.js";
import { resolveSidecarOut } from "../shared/sidecar-out.js";
import { grantKeyCommander } from "./key-init.js";
import { signGrantPayload } from "./sign.js";
import { loadOrCreateSigningKey } from "./signing-key.js";
import { discoverWorkspaceRoot, loadSlice } from "./workspace.js";
import { grantShowCommand, type ShowOptions } from "./show.js";
import { grantCheckCommand, type CheckOptions } from "./check.js";

/** Commander parser that keeps every occurrence of a repeated flag. */
function collectValues(value: string, previous?: string[]): string[] {
  return [...(previous ?? []), value];
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

interface IssueOptions {
  principal: string;
  agent: string;
  paths?: string;
  tools: string;
  mode: "write" | "propose";
  expiresIn: string;
  contexts?: string;
  maxFiles?: string;
  workspaceRoot?: string;
  out?: string;
  keyFile?: string;
  engagement?: string;
  /** Test seam; defaults to `os.homedir()`. */
  homeDir?: string;
  /** Brownfield: consent to the writes listed in the preflight. */
  yes?: boolean;
}

/** Brownfield failures exit 2 (usage/precondition), distinct from repo mode's 1. */
function failBrownfield(message: string): void {
  console.error(message);
  process.exitCode = 2;
}

class GrantFileExistsError extends Error {}

/**
 * Temp file, then a hard link to the final name: `link` fails with EEXIST
 * instead of replacing, so an existing grant is never overwritten, and a
 * reader never sees a half-written grant.
 */
async function writeGrantFileExclusive(
  target: string,
  text: string,
): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  const handle = await open(tmp, "wx");
  try {
    try {
      await handle.writeFile(text, "utf-8");
    } finally {
      await handle.close();
    }
    await link(tmp, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new GrantFileExistsError(`${target} already exists`);
    }
    throw error;
  } finally {
    await unlink(tmp).catch(() => undefined);
  }
}

export async function issueGrantCommand(options: IssueOptions): Promise<void> {
  const workspaceRoot = discoverWorkspaceRoot(options.workspaceRoot);

  if (options.mode !== "write" && options.mode !== "propose") {
    console.error(`--mode must be 'write' or 'propose', got '${options.mode}'`);
    process.exitCode = 1;
    return;
  }

  const brownfield = !isRepoMode(workspaceRoot);
  let slice: Slice | undefined;
  if (brownfield) {
    try {
      slice = await loadSlice(workspaceRoot);
    } catch (error) {
      failBrownfield(
        `.hexagen/slice.json is not a valid slice: ${(error as Error).message}`,
      );
      return;
    }
    if (options.contexts) {
      failBrownfield(
        "--contexts needs a manifest; there is none here. Pass --paths (or rely on the slice's paths).",
      );
      return;
    }
    if (slice && !options.paths && slice.paths.length === 0) {
      failBrownfield(
        "The slice names no paths, so a grant from it would deny everything. Edit .hexagen/slice.json or pass --paths.",
      );
      return;
    }
  }

  const paths = options.paths
    ? splitCsv(options.paths)
    : brownfield && slice
      ? [...slice.paths]
      : [];
  const contexts = options.contexts ? splitCsv(options.contexts) : [];
  const tools = splitCsv(options.tools);

  if (paths.length === 0 && contexts.length === 0) {
    console.error(
      "At least one of --paths or --contexts is required — an empty-path grant denies everything.",
    );
    process.exitCode = 1;
    return;
  }
  if (tools.length === 0) {
    console.error(
      "--tools is required and must name at least one tool — an empty-tools grant denies everything.",
    );
    process.exitCode = 1;
    return;
  }

  let maxFiles: number | undefined;
  if (options.maxFiles !== undefined) {
    maxFiles = Number(options.maxFiles);
    if (!Number.isInteger(maxFiles) || maxFiles < 1) {
      console.error(
        `--max-files must be a positive integer, got '${options.maxFiles}'`,
      );
      process.exitCode = 1;
      return;
    }
  }

  let contextPaths: string[] = [];
  let allContexts: string[] = contexts;
  try {
    if (contexts.length > 0) {
      contextPaths = await expandContexts(workspaceRoot, contexts);
    }
    // A grant issued on --paths alone still needs `grant.contexts` to name
    // every context it authorizes — the accept path checks contexts
    // independently of paths (see build.ts deriveContextsFromPaths). This
    // reverse-matches any packages/<name>/ prefixes already in --paths so
    // the caller doesn't have to pass the same name twice via --contexts.
    const derived = await deriveContextsFromPaths(workspaceRoot, paths);
    allContexts = [...new Set([...contexts, ...derived])];
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  const engagementId = options.engagement ?? slice?.id;
  let brownfieldKey:
    | { keyHex: string; path: string; fingerprint: string }
    | undefined;
  let brownfieldOut: string | undefined;
  let applyExclude = false;
  if (brownfield) {
    if (engagementId === undefined) {
      failBrownfield(
        "No manifest and no .hexagen/slice.json: name the engagement with --engagement <id> (or create the slice first).",
      );
      return;
    }
    for (const entry of paths) {
      const normalized = normalizeSlicePath(entry);
      if (!normalized.ok) {
        failBrownfield(
          `--paths entry '${entry}' is malformed: ${normalized.reason}`,
        );
        return;
      }
      if (slice && !isPathInSlice(slice as SlicePaths, entry)) {
        failBrownfield(
          `--paths entry '${entry}' is outside the slice (or excluded by it)`,
        );
        return;
      }
    }
    // Grants carry no excludes, so a directory entry would silently re-admit
    // anything the slice excludes beneath it.
    for (const entry of paths) {
      const beneath = slice?.excludes.find(
        (e) => e !== entry && e.startsWith(entry) && entry.endsWith("/"),
      );
      if (beneath !== undefined) {
        failBrownfield(
          `--paths entry '${entry}' contains the slice exclude '${beneath}'; a grant carries no excludes, so issue narrower paths that avoid it.`,
        );
        return;
      }
    }
    if (options.out !== undefined) {
      const target = await resolveSidecarOut(workspaceRoot, options.out).catch(
        () => null,
      );
      if (!target) {
        failBrownfield(
          `--out must name a file under ${path.join(workspaceRoot, ".hexagen")}${path.sep}; got "${options.out}"`,
        );
        return;
      }
      if (
        await lstat(target).then(
          () => true,
          () => false,
        )
      ) {
        console.error(
          `[grant issue] ${target} already exists; refusing to overwrite a grant.`,
        );
        process.exitCode = 1;
        return;
      }
      brownfieldOut = target;
    }
    const env = process.env;
    const resolved = resolveGrantKey({
      keyFile: options.keyFile,
      env,
      engagementId,
      workspaceRoot,
      homeDir: options.homeDir,
    });
    if (resolved.path === null) {
      failBrownfield(`Cannot locate a signing key: ${resolved.problem}`);
      return;
    }
    const read = readGrantKey(resolved.path);
    if (!read.ok) {
      failBrownfield(
        `${read.problem}. Create one with: hexagen grant key init --engagement ${engagementId}`,
      );
      return;
    }
    brownfieldKey = {
      keyHex: read.keyHex,
      path: resolved.path,
      fingerprint: read.fingerprint,
    };
    const engagementOverride =
      options.engagement !== undefined &&
      slice !== undefined &&
      options.engagement !== slice.id;
    if (options.keyFile || engagementOverride) {
      // What the MCP server resolves without the flags (the slice's own id): a
      // split here means it will deny this grant, so say so at issue time,
      // with both engagement ids, paths and fingerprints.
      const server = resolveGrantKey({
        env,
        engagementId: slice?.id,
        workspaceRoot,
        homeDir: options.homeDir,
      });
      if (server.path !== null) {
        const mismatch = describeKeyMismatch(
          `issuing (engagement ${engagementId})`,
          resolved,
          `server default (engagement ${slice?.id ?? "none"})`,
          server,
        );
        if (mismatch) console.error(`[grant issue] warning: ${mismatch}`);
      }
    }
    console.error(
      `[grant issue] workspace root ${workspaceRoot}; key ${brownfieldKey.path}; fingerprint ${brownfieldKey.fingerprint}`,
    );

    // The sidecar dir stays out of `git status` via .git/info/exclude (never
    // the client's .gitignore). List every write; --yes is required only when
    // something will actually be written (the grant file or an exclude change).
    let exclude: { file: string; changes: boolean };
    try {
      exclude = await excludeWouldChange(workspaceRoot, ".hexagen/");
    } catch (error) {
      failBrownfield(`[grant issue] ${(error as Error).message}`);
      return;
    }
    const writes: string[] = [];
    if (brownfieldOut) writes.push(`grant file: ${brownfieldOut}`);
    if (exclude.changes) {
      writes.push(`exclude file: ${exclude.file} (adds .hexagen/)`);
    }
    if (writes.length > 0) {
      console.error(
        `[grant issue] preflight, will write:\n${writes.map((w) => `  - ${w}`).join("\n")}`,
      );
      if (!options.yes) {
        failBrownfield(
          "[grant issue] nothing written; re-run with --yes to proceed.",
        );
        return;
      }
    }
    applyExclude = exclude.changes;
  }

  let keyHex: string;
  try {
    const explicit =
      !brownfield && (options.keyFile || process.env.HEXAGEN_GRANT_KEY_FILE)
        ? resolveGrantKey({
            keyFile: options.keyFile,
            env: process.env,
            workspaceRoot,
          })
        : undefined;
    let key: { keyHex: string; created: boolean; path: string };
    if (brownfieldKey) {
      key = {
        keyHex: brownfieldKey.keyHex,
        created: false,
        path: brownfieldKey.path,
      };
    } else if (explicit?.path) {
      const read = readGrantKey(explicit.path);
      if (!read.ok) throw new Error(read.problem);
      key = { keyHex: read.keyHex, created: false, path: explicit.path };
      console.error(
        `[grant issue] workspace root ${workspaceRoot}; key ${explicit.path}; fingerprint ${read.fingerprint}`,
      );
    } else {
      key = await loadOrCreateSigningKey(workspaceRoot);
    }
    keyHex = key.keyHex;
    if (key.created) {
      console.error(
        `[grant issue] no signing key found — created one at ${key.path}. ` +
          `This is a secret: make sure .hexagen/grant-signing.key is in .gitignore and never commit it.`,
      );
    }
  } catch (error) {
    console.error(
      `Could not load the signing key: ${(error as Error).message}`,
    );
    process.exitCode = 1;
    return;
  }

  let grant: IssuedGrant;
  try {
    grant = await buildGrant(
      {
        principal: options.principal,
        agent: options.agent,
        paths,
        tools,
        mode: options.mode,
        expiresIn: options.expiresIn,
        contexts: allContexts.length > 0 ? allContexts : undefined,
        maxFiles,
        omitContexts: brownfield,
      },
      keyHex,
      signGrantPayload,
      contextPaths,
    );
  } catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
    return;
  }

  const json = JSON.stringify(grant, null, 2);
  if (brownfield) {
    // Everything is validated and the grant is signed; only now touch the
    // exclude file, and still before the grant file is written.
    if (applyExclude) {
      try {
        await ensureExcluded(workspaceRoot, ".hexagen/");
      } catch (error) {
        failBrownfield(
          `[grant issue] ${error instanceof GitExcludeError ? error.message : String(error)}`,
        );
        return;
      }
    }
    if (brownfieldOut) {
      try {
        await writeGrantFileExclusive(brownfieldOut, `${json}\n`);
      } catch (error) {
        console.error(
          `[grant issue] could not write ${brownfieldOut}: ${(error as Error).message}`,
        );
        process.exitCode = error instanceof GrantFileExistsError ? 1 : 2;
        return;
      }
      console.error(
        `[grant issue] wrote ${brownfieldOut} (id: ${grant.id}, expires: ${grant.expires_at})`,
      );
    } else {
      console.log(json);
    }
    return;
  }
  if (options.out) {
    const outPath = path.resolve(workspaceRoot, options.out);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${json}\n`, "utf-8");
    console.error(
      `[grant issue] wrote ${outPath} (id: ${grant.id}, expires: ${grant.expires_at})`,
    );
  } else {
    console.log(json);
  }
}

export const grantCommander = new Command("grant").description(
  "Issue, show and check Grant objects (docs/kernel/GRANT.md)",
);

grantCommander.addCommand(grantKeyCommander);

grantCommander
  .command("issue")
  .description(
    "Mint a signed Grant — the file hexagen_accept_transaction trusts as its `grant` argument",
  )
  .requiredOption("--principal <id>", "Who authorized this cycle")
  .requiredOption(
    "--agent <id>",
    "Which agent identity this grant is issued to",
  )
  .option(
    "--paths <prefix[,prefix...]>",
    "Workspace-relative path prefixes this cycle may write to (comma-separated)",
  )
  .requiredOption(
    "--tools <tool[,tool...]>",
    "Write tool names this cycle may invoke (comma-separated)",
  )
  .option("--mode <write|propose>", "Grant mode", "write")
  .requiredOption(
    "--expires-in <duration>",
    "How long the grant is valid from now, e.g. 4h, 30m, 900s, 1d",
  )
  .option(
    "--contexts <name[,name...]>",
    "Monaco-only: manifest.yaml bounded-context names, expanded to packages/<name>/ and appended to --paths. Fails if a name isn't a real context. Any packages/<name>/ prefix already in --paths that matches a known context is folded into the grant's contexts too, so --contexts can usually be omitted.",
  )
  .option(
    "--max-files <n>",
    "Optional cap on distinct files touched in one cycle",
  )
  .option(
    "--workspace-root <path>",
    "Workspace root to resolve .hexagen/grant-signing.key and manifest.yaml against (default: nearest project/workspace root found by walking up from cwd)",
  )
  .option(
    "--key-file <path>",
    "Signing key file (overrides HEXAGEN_GRANT_KEY_FILE and ~/.hexagen/keys/<engagement>.key)",
  )
  .option(
    "--engagement <id>",
    "Brownfield: engagement id naming ~/.hexagen/keys/<id>.key (default: the id in .hexagen/slice.json)",
  )
  .option(
    "--yes",
    "Brownfield: required when the preflight lists a write (the --out grant file or a .git/info/exclude change)",
  )
  .option(
    "--out <file>",
    "Write the signed grant JSON here instead of stdout (brownfield: must be a new file under <root>/.hexagen/)",
  )
  .action(async (options: IssueOptions) => {
    await issueGrantCommand(options);
  });

grantCommander
  .command("show")
  .description(
    "Pretty-print a grant file and report whether its signature verifies (exit 0 verified, 1 not, 2 bad input)",
  )
  .argument("<grant-file>", "Path to a signed grant JSON file")
  .option(
    "--workspace-root <path>",
    "Workspace root (default: nearest project/workspace root, bounded by the git toplevel)",
  )
  .option(
    "--key-file <path>",
    "Verification key file (overrides HEXAGEN_GRANT_KEY_FILE and ~/.hexagen/keys/<engagement>.key)",
  )
  .option(
    "--engagement <id>",
    "Brownfield: engagement id naming ~/.hexagen/keys/<id>.key (default: the id in .hexagen/slice.json)",
  )
  .action(
    async (
      grantFile: string,
      options: Omit<ShowOptions, "grantFile">,
    ): Promise<void> => {
      await grantShowCommand({ ...options, grantFile });
    },
  );

grantCommander
  .command("check")
  .description(
    "Dry-run whether a write is allowed: signature, then window, then tool and paths (and, in a client repo, the slice). Exit 0 allow, 1 deny, 2 bad input",
  )
  .argument("<grant-file>", "Path to a signed grant JSON file")
  .argument(
    "[transaction-id]",
    "Monaco form: a pending transaction id (not built; exits 2)",
  )
  .option(
    "--tool <tool>",
    "Tool the write would use (once; a repeat exits 2)",
    collectValues,
  )
  .option(
    "--path <path...>",
    "Repo-relative file path(s) the write would touch; repeat the flag or list several",
    collectValues,
  )
  .option(
    "--workspace-root <path>",
    "Workspace root (default: nearest project/workspace root, bounded by the git toplevel)",
  )
  .option(
    "--key-file <path>",
    "Verification key file (overrides HEXAGEN_GRANT_KEY_FILE and ~/.hexagen/keys/<engagement>.key)",
  )
  .option(
    "--engagement <id>",
    "Brownfield: engagement id naming ~/.hexagen/keys/<id>.key (default: the id in .hexagen/slice.json)",
  )
  .action(
    async (
      grantFile: string,
      transactionId: string | undefined,
      options: Omit<CheckOptions, "grantFile" | "transactionId">,
    ): Promise<void> => {
      await grantCheckCommand({ ...options, grantFile, transactionId });
    },
  );
