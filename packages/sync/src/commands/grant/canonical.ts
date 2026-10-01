/**
 * The exact bytes a Grant's signature is computed over.
 *
 * This MUST byte-for-byte match `canonicalGrantPayload` in
 * `packages/mcp-server/src/application/kernel/grant.ts` — that is the
 * function `GrantSignatureAdapter.verify` runs at the accept choke point.
 * The two packages cannot share one implementation without `@hexagen/sync`
 * depending on `@hexagen/mcp-server` (the wrong direction: `mcp-server`
 * already depends on `sync`), so this is a deliberate, pinned duplicate —
 * see `__tests__/commands/grant/canonical.test.ts`, which locks the output
 * for a fixed sample grant so the two can't silently drift.
 */
export interface GrantFields {
  readonly id: string;
  readonly principal: string;
  readonly agent: string;
  /** Absent on a client-repo grant (it never writes `[]`); absent and `[]` sign differently. */
  readonly contexts?: readonly string[];
  readonly paths: readonly string[];
  readonly tools: readonly string[];
  readonly mode: "write" | "propose";
  readonly max_files?: number;
  readonly expires_at: string;
  readonly revoked_at?: string;
}

export function canonicalGrantPayload(grant: GrantFields): string {
  const signable: GrantFields = {
    id: grant.id,
    principal: grant.principal,
    agent: grant.agent,
    contexts: grant.contexts,
    paths: grant.paths,
    tools: grant.tools,
    mode: grant.mode,
    max_files: grant.max_files,
    expires_at: grant.expires_at,
    revoked_at: grant.revoked_at,
  };
  return JSON.stringify(signable, Object.keys(signable).sort());
}
