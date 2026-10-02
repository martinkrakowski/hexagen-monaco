/* eslint-disable no-console */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  Slice,
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
import { grantKeyCommander } from "./key-init.js";
import { signGrantPayload } from "./sign.js";
import { loadOrCreateSigningKey } from "./signing-key.js";
import { findWorkspaceRoot } from "../shared/project-root.js";

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

async function loadSlice(workspaceRoot: string): Promise<Slice | undefined> {
  let raw: string;
  try {
    raw = await readFile(
      path.join(workspaceRoot, ".hexagen", "slice.json"),
      "utf-8",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return Slice.parse(JSON.parse(raw));
}

export async function issueGrantCommand(options: IssueOptions): Promise<void> {
  // Discovered root, not raw cwd — invoked from a package subdirectory,
  // cwd would separate the manifest lookup and the signing key from the
  // workspace the verifier actually reads (see Qodo "Nested-directory
  // issuance uses the wrong key"). `--workspace-root` still overrides this
  // outright, same as before.
  const workspaceRoot = options.workspaceRoot
    ? path.resolve(options.workspaceRoot)
    : (findWorkspaceRoot(process.cwd()) ?? process.cwd());

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
    if (options.keyFile) {
      // What the MCP server resolves without the flag: a split here means it
      // will deny this grant, so say so at issue time, with both fingerprints.
      const server = resolveGrantKey({
        env,
        engagementId,
        workspaceRoot,
        homeDir: options.homeDir,
      });
      if (server.path !== null) {
        const mismatch = describeKeyMismatch(
          "issuing",
          resolved,
          "server default",
          server,
        );
        if (mismatch) console.error(`[grant issue] warning: ${mismatch}`);
      }
    }
    console.error(
      `[grant issue] workspace root ${workspaceRoot}; key ${brownfieldKey.path}; fingerprint ${brownfieldKey.fingerprint}`,
    );
  }

  if (brownfield) {
    // The sidecar dir stays out of `git status` via .git/info/exclude (never
    // the client's .gitignore). List every write, then require --yes.
    let exclude: { file: string; changes: boolean };
    try {
      exclude = await excludeWouldChange(workspaceRoot, ".hexagen/");
    } catch (error) {
      failBrownfield(`[grant issue] ${(error as Error).message}`);
      return;
    }
    const writes: string[] = [];
    if (options.out) {
      writes.push(`grant file: ${path.resolve(workspaceRoot, options.out)}`);
    }
    if (exclude.changes) {
      writes.push(`exclude file: ${exclude.file} (adds .hexagen/)`);
    }
    console.error(
      writes.length > 0
        ? `[grant issue] preflight, will write:\n${writes.map((w) => `  - ${w}`).join("\n")}`
        : "[grant issue] preflight: no files to write (grant goes to stdout)",
    );
    if (!options.yes) {
      failBrownfield(
        "[grant issue] nothing written; re-run with --yes to proceed.",
      );
      return;
    }
    try {
      await ensureExcluded(workspaceRoot, ".hexagen/");
    } catch (error) {
      failBrownfield(
        `[grant issue] ${error instanceof GitExcludeError ? error.message : String(error)}`,
      );
      return;
    }
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
  "Issue and inspect Grant objects (docs/kernel/GRANT.md)",
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
    "Brownfield: proceed with the writes the preflight lists (grant file, .git/info/exclude)",
  )
  .option("--out <file>", "Write the signed grant JSON here instead of stdout")
  .action(async (options: IssueOptions) => {
    await issueGrantCommand(options);
  });
