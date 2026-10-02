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
  /**
   * Brownfield (no manifest): leave `contexts` off the grant entirely. Absent
   * and `[]` sign differently, and a client-repo grant never writes `[]`.
   */
  readonly omitContexts?: boolean;
  readonly now?: Date;
}

export interface IssuedGrant extends GrantFields {
  readonly signature: string;
}

// Pinned duplicate of mcp-server's `MANIFEST_WRITE_PATH`
// (packages/mcp-server/src/application/kernel/grant.ts) — every manifest
// mutation writes through this path regardless of context, and
// `checkMutationAgainstGrant` requires it in `grant.paths` independently of
// `grant.contexts`. Sync can't import mcp-server (reverse dependency
// direction), so this is pinned the same way `canonical.ts` pins the
// signing payload shape.
const MANIFEST_WRITE_PATH = ".architecture/";

async function loadBoundedContexts(
  workspaceRoot: string,
): Promise<Set<string> | null> {
  const manifestPath = path.join(
    workspaceRoot,
    ".architecture",
    "manifest.yaml",
  );
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const parsed = yaml.load(raw) as
    | { bounded_contexts?: Array<{ name: string }> }
    | undefined;
  return new Set((parsed?.bounded_contexts ?? []).map((c) => c.name));
}

/**
 * Looks up each `--contexts` name in `manifest.yaml`'s `bounded_contexts`
 * and expands it to `packages/<context>/`, per docs/kernel/GRANT.md
 * "Compiling a grant". A name that isn't a real context is a hard error
 * (fail closed) — never a silently-dropped entry.
 */
export async function expandContexts(
  workspaceRoot: string,
  contexts: readonly string[],
): Promise<string[]> {
  const known = await loadBoundedContexts(workspaceRoot);
  if (known === null) {
    throw new Error(
      `--contexts was given but no manifest exists at ${path.join(workspaceRoot, ".architecture", "manifest.yaml")}. ` +
        `Omit --contexts and pass the full prefixes via --paths instead.`,
    );
  }
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
 * `checkMutationAgainstGrant` requires `grant.contexts` to independently
 * name every context a mutation targets — `grant.paths` covering
 * `packages/<context>/` is not enough on its own (see
 * packages/mcp-server/src/application/kernel/grant.ts
 * `checkMutationAgainstGrant`, "An empty `grant.contexts` ... denies
 * everything by construction"). So a grant issued on `--paths` alone,
 * naming `packages/<context>/` prefixes but no `--contexts`, would
 * otherwise sign with `contexts: []` and be denied for every mutation —
 * contradicting the documented paths-only flow. This reverse-matches each
 * `packages/<name>/` path prefix against the manifest's known contexts so
 * those names land in `grant.contexts` too, without requiring the caller
 * to repeat them via `--contexts`. Returns `[]` (never throws) when no
 * manifest exists or no path matches a known context — that's the one
 * case a true paths-only grant (no manifest at all) is deliberately
 * useless against this manifest-only enforcement adapter, not a bug to
 * paper over here.
 */
export async function deriveContextsFromPaths(
  workspaceRoot: string,
  paths: readonly string[],
): Promise<string[]> {
  const known = await loadBoundedContexts(workspaceRoot);
  if (known === null) return [];
  const derived = new Set<string>();
  for (const candidate of paths) {
    const match = /^packages\/([^/]+)\/$/.exec(candidate);
    if (match && known.has(match[1])) {
      derived.add(match[1]);
    }
  }
  return [...derived];
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

  // Brownfield grants name no contexts, so nothing may reach for the
  // manifest-only `.architecture/` path below either.
  const contexts = input.omitContexts ? [] : (input.contexts ?? []);
  const unsigned: GrantFields = {
    id: randomUUID(),
    principal: input.principal,
    agent: input.agent,
    ...(input.omitContexts ? {} : { contexts }),
    paths: [
      ...new Set([
        ...input.paths,
        ...contextPaths,
        // Every manifest mutation writes through MANIFEST_WRITE_PATH
        // regardless of context, and the accept path requires it
        // independently of the scaffolding package path — see
        // checkMutationAgainstGrant. Auto-include it whenever this grant
        // authorizes any context, so the caller doesn't have to know to
        // repeat it in --paths (see Qodo finding "Contexts-only grants
        // cannot land writes").
        ...(contexts.length > 0 ? [MANIFEST_WRITE_PATH] : []),
      ]),
    ],
    tools: input.tools,
    mode: input.mode,
    max_files: input.maxFiles,
    expires_at: expiresAt,
  };

  const signature = signFn(canonicalGrantPayload(unsigned), keyHex);
  return { ...unsigned, signature };
}
