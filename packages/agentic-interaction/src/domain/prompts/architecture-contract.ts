/**
 * Architecture contract — single source of truth for the token vocabulary that
 * keeps generated bounded-context names free of infrastructure, vendor,
 * delivery, and layering nouns.
 *
 * ── UNIFIED POLICY (reconciled in A2; previously a documented divergence) ───
 * Every consumption site shares ONE membership: the full union
 * STRUCTURAL + DELIVERY + INFRA_CORE + VENDOR. What differs per site is the
 * MECHANISM, not the policy:
 *
 *   • Stage 0 / Stage 2 generation guidance — the list is interpolated as
 *     prose into the system prompts (steers the model away from banned names
 *     up front; probabilistic).
 *   • Stage 6 R01 validation — the validator LLM is told the same list
 *     (defense in depth; probabilistic).
 *   • Deterministic runtime filter — `isBannedContextName()` is the
 *     enforcement of record: token-boundary matching, NOT substring, so
 *     "restaurant-booking" / "feedback-management" / "rapid-fulfillment" pass
 *     while "user-database", "APIGateway", "payment_db" are rejected.
 *
 * This reconciliation killed three contradiction cases the old divergence
 * produced: "stripe-payments" (generate-then-reject), "api-gateway"
 * (silent-drop), "user-database" (validator pass-through). See
 * __tests__/use-cases/staged-generation/ban-list-reconciliation.test.ts.
 *
 * Token-boundary trade-off (accepted deliberately): names with no separator
 * at all ("userdb", "paymentsapi") tokenize to a single unknown token and are
 * NOT caught deterministically — the Stage 2/6 prompt guidance remains the
 * only guard for those. The substring alternative was rejected because it
 * falsely banned real business names ("restaurant-booking" ⊃ "rest").
 *
 * The per-site exports below are retained as aliases of the canonical list so
 * tests can pin set-equality and any future re-divergence is loud.
 */

/** Infra / storage / transport tokens. */
export const INFRA_CORE_TOKENS = [
  "postgres",
  "redis",
  "mongo",
  "rabbit",
  "kafka",
  "mqtt",
  "s3",
] as const;

/** Vendor / extended-datastore tokens. */
export const VENDOR_TOKENS = [
  "stripe",
  "supabase",
  "firebase",
  "sendgrid",
  "mysql",
  "elasticsearch",
  "dynamo",
  "sqs",
  "sns",
] as const;

/** Layering / structural nouns — a bounded CONTEXT must not be named after one
 * (note: these are legitimate inside PORT names, e.g. `OrderRepositoryPort`,
 * which is why this contract only ever guards CONTEXT names). */
export const STRUCTURAL_NOUNS = [
  "adapter",
  "repository",
  "cache",
  "queue",
  "database",
] as const;

/** Delivery / abbreviation tokens. */
export const DELIVERY_TOKENS = [
  "db",
  "api",
  "gateway",
  "rest",
  "graphql",
] as const;

/** Canonical unified ban list — the full union of all four token families.
 * Single membership for every consumption site (generation, validation,
 * deterministic filter). */
export const CONTEXT_NAME_BANNED_TOKENS: readonly string[] = [
  ...STRUCTURAL_NOUNS,
  ...DELIVERY_TOKENS,
  ...INFRA_CORE_TOKENS,
  ...VENDOR_TOKENS,
];

/** Stage 0/2 generation guidance (prose). Alias of the canonical list. */
export const CONTEXT_NAME_GENERATION_BANS: readonly string[] =
  CONTEXT_NAME_BANNED_TOKENS;

/** Stage 6 R01 validation (prose). Alias of the canonical list. */
export const CONTEXT_NAME_VALIDATION_BANS: readonly string[] =
  CONTEXT_NAME_BANNED_TOKENS;

/** Deterministic runtime safety filter. Alias of the canonical list; matching
 * is performed by `isBannedContextName`, not by callers iterating this array. */
export const CONTEXT_NAME_DETERMINISTIC_BLOCKLIST: readonly string[] =
  CONTEXT_NAME_BANNED_TOKENS;

const BANNED_TOKEN_SET: ReadonlySet<string> = new Set(
  CONTEXT_NAME_BANNED_TOKENS,
);

/** Split a context name into lowercase word tokens. Boundaries: any
 * non-alphanumeric separator (-, _, space, …), camelCase transitions
 * ("PostgresStore" → ["postgres", "store"]), and acronym runs
 * ("APIGateway" → ["api", "gateway"]). Digits stay attached to their word,
 * so "s3" survives as a token. */
function tokenizeContextName(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Deterministic enforcement of record for the unified ban policy: true when
 * any token of `name` is a banned structural/delivery/infra/vendor token. */
export function isBannedContextName(name: string): boolean {
  return tokenizeContextName(name).some((token) => BANNED_TOKEN_SET.has(token));
}
