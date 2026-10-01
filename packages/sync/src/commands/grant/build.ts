import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { canonicalGrantPayload, type GrantFields } from "./canonical.js";
import { parseDurationMs } from "./duration.js";

export interface IssueGrantInput {
  readonly principal: string;
  readonly agent: string;
  readonly paths: readonly string[];
  readonly tools: readonly string[];
  readonly mode: "write" | "propose";
  readonly expiresIn: string;
  readonly contexts?: readonly string[];
  readonly maxFiles?: number;
  readonly now?: Date;
}

export interface IssuedGrant extends GrantFields {
  readonly signature: string;
}

/**
 * Looks up each `--contexts` name in `manifest.yaml`'s `bounded_contexts`
 * and expands it to `packages/<context>/`, per docs/kernel/GRANT.md
 * "Compiling a grant". A name that isn't a real context is a hard error
 * (fail closed) — never a silently-dropped entry. `contexts` is optional:
 * a repo with no manifest to compile against issues on `--paths` alone.
 */
export async function expandContexts(
  workspaceRoot: string,
  contexts: readonly string[],
): Promise<string[]> {
  const manifestPath = path.join(workspaceRoot, ".architecture", "manifest.yaml");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `--contexts was given but no manifest exists at ${manifestPath}. ` +
          `Omit --contexts and pass the full prefixes via --paths instead.`,
      );
    }
    throw error;
  }
  const parsed = yaml.load(raw) as
    | { bounded_contexts?: Array<{ name: string }> }
    | undefined;
  const known = new Set((parsed?.bounded_contexts ?? []).map((c) => c.name));
  const unknown = contexts.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown bounded context(s) in --contexts: ${unknown.join(", ")}. ` +
        `Known contexts: ${[...known].sort().join(", ") || "(none)"}`,
    );
  }
  return contexts.map((name) => `packages/${name}/`);
}

/**
 * Assembles and signs a Grant. Pure apart from the signature HMAC itself —
 * `id` and `expires_at` are the only non-deterministic-by-design fields
 * (fresh id, now + expiresIn), both overridable via `now` for tests.
 */
export async function buildGrant(
  input: IssueGrantInput,
  keyHex: string,
  signFn: (payload: string, keyHex: string) => string,
  contextPaths: readonly string[] = [],
): Promise<IssuedGrant> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(
    now.getTime() + parseDurationMs(input.expiresIn),
  ).toISOString();

  const unsigned: GrantFields = {
    id: randomUUID(),
    principal: input.principal,
    agent: input.agent,
    contexts: input.contexts ?? [],
    paths: [...new Set([...input.paths, ...contextPaths])],
    tools: input.tools,
    mode: input.mode,
    max_files: input.maxFiles,
    expires_at: expiresAt,
  };

  const signature = signFn(canonicalGrantPayload(unsigned), keyHex);
  return { ...unsigned, signature };
}
