/* eslint-disable no-console */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  buildGrant,
  deriveContextsFromPaths,
  expandContexts,
  type IssuedGrant,
} from "./build.js";
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

  const paths = options.paths ? splitCsv(options.paths) : [];
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

  let keyHex: string;
  try {
    const key = await loadOrCreateSigningKey(workspaceRoot);
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
  .option("--out <file>", "Write the signed grant JSON here instead of stdout")
  .action(async (options: IssueOptions) => {
    await issueGrantCommand(options);
  });
