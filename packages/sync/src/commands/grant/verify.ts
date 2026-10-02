import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Grant } from "@hexagen/shared";
import {
  describeKeyMismatch,
  readGrantKey,
  readSliceEngagementId,
  resolveGrantKey,
  type ResolvedGrantKey,
} from "@hexagen/shared/node/grant-key";
import { canonicalGrantPayload } from "./canonical.js";

/** The wire shape of a signed grant (docs/kernel/grant.schema.json). Unknown fields are refused: they would be unsigned. */
const GrantFile = z
  .object({
    id: z.string().min(1),
    principal: z.string().min(1),
    agent: z.string().min(1),
    contexts: z.array(z.string().min(1)).optional(),
    paths: z.array(z.string().min(1)),
    tools: z.array(z.string().min(1)),
    mode: z.enum(["write", "propose"]),
    max_files: z.number().int().min(1).optional(),
    expires_at: z.string().min(1),
    revoked_at: z.string().min(1).optional(),
    signature: z.string().optional(),
  })
  .strict();

export type LoadedGrant =
  | { readonly ok: true; readonly grant: Grant }
  | { readonly ok: false; readonly problem: string };

/** Reads and shape-checks a grant file. A failure here is bad input (exit 2), not a denial. */
export async function loadGrantFile(file: string): Promise<LoadedGrant> {
  let raw: string;
  try {
    raw = await readFile(file, "utf-8");
  } catch (error) {
    return {
      ok: false,
      problem: `cannot read grant file ${file}: ${(error as Error).message}`,
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, problem: `${file} is not valid JSON` };
  }
  const parsed = GrantFile.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      problem: `${file} is not a grant: ${issue?.path.join(".") || "(root)"}: ${issue?.message}`,
    };
  }
  return { ok: true, grant: parsed.data };
}

export interface VerifyContext {
  readonly workspaceRoot: string;
  readonly keyFile?: string;
  readonly engagement?: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Test seam; defaults to `os.homedir()`. */
  readonly homeDir?: string;
}

export interface GrantVerification {
  readonly verified: boolean;
  /** Why not, when not. Never contains key material. */
  readonly reason?: string;
  readonly key: ResolvedGrantKey;
}

/** The same resolution `hexagen grant issue` and the MCP server use. */
export function resolveVerifyKey(ctx: VerifyContext): ResolvedGrantKey {
  return resolveGrantKey({
    keyFile: ctx.keyFile,
    env: ctx.env,
    engagementId: ctx.engagement ?? readSliceEngagementId(ctx.workspaceRoot),
    workspaceRoot: ctx.workspaceRoot,
    homeDir: ctx.homeDir,
  });
}

/**
 * Verifies `grant.signature` (HMAC-SHA256 hex over the canonical payload)
 * against the key the shared resolver finds. Fails closed on every way trust
 * can fail to be established: no signature, a malformed one, no key location,
 * a missing or weak key, or a mismatch. When the operator overrode the key
 * (`--key-file` / `--engagement`) and it fails, the message also names the key
 * the MCP server would use without the override, with both fingerprints.
 */
export function verifyGrantSignature(
  grant: Grant,
  ctx: VerifyContext,
): GrantVerification {
  const key = resolveVerifyKey(ctx);
  const fail = (reason: string): GrantVerification => ({
    verified: false,
    reason,
    key,
  });

  if (key.path === null) return fail(key.problem ?? "no key location");
  const read = readGrantKey(key.path);
  if (!read.ok) return fail(read.problem);
  if (!grant.signature) return fail("the grant carries no signature");
  if (!/^[0-9a-f]+$/i.test(grant.signature) || grant.signature.length % 2) {
    return fail("the grant's signature is not a hex string");
  }

  const expected = createHmac("sha256", Buffer.from(read.keyHex, "hex"))
    .update(canonicalGrantPayload(grant))
    .digest();
  const given = Buffer.from(grant.signature, "hex");
  if (given.length === expected.length && timingSafeEqual(given, expected)) {
    return { verified: true, key };
  }

  let reason =
    "signature does not match: the grant was edited after signing or signed under a different key";
  if (ctx.keyFile || ctx.engagement) {
    const server = resolveGrantKey({
      env: ctx.env,
      engagementId: readSliceEngagementId(ctx.workspaceRoot),
      workspaceRoot: ctx.workspaceRoot,
      homeDir: ctx.homeDir,
    });
    if (server.path !== null) {
      const mismatch = describeKeyMismatch(
        "verifying with",
        key,
        "server default",
        server,
      );
      if (mismatch) reason += `; ${mismatch}`;
    }
  }
  return fail(reason);
}
