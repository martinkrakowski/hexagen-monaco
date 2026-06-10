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
 *   • Stage 6 R01 validation — computed deterministically via
 *     `isBannedContextName()` inside ExecuteValidationReviewUseCase; any R01
 *     claim the judge LLM emits is discarded. (Previously the list was
 *     interpolated into the judge prompt — weak models parroted the tokens
 *     against clean names; see baseline findings F2/F3.)
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
 * Token-boundary trade-offs (accepted deliberately): names with no separator
 * at all ("userdb", "paymentsapi") and digit-fused variants ("123db",
 * "db123") tokenize to a single unknown token and are NOT caught
 * deterministically — the Stage 2/6 prompt guidance remains the only guard
 * for those. The substring alternative was rejected because it falsely
 * banned real business names ("restaurant-booking" ⊃ "rest").
 *
 * PROSE-ONLY carve-out (HITL decision, PR #285 review round): "rest" stays in
 * the prompt-guidance lists but is excluded from the deterministic filter —
 * it is a plain English word ("driver-rest-periods", "crew-rest") and the
 * false-reject cost outweighs the leak risk; "api"/"gateway"/"db" remain
 * deterministic because names containing them are near-always tech leakage.
 *
 * The per-site exports below are retained as aliases of the canonical list so
 * tests can pin membership and any future re-divergence is loud.
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

/** Stage 6 R01 validation. Alias of the canonical list. No longer
 * interpolated into the judge prompt (judge-grounding fix) — R01 is computed
 * via `isBannedContextName`; the alias is retained so tests can pin
 * membership and any re-divergence is loud. */
export const CONTEXT_NAME_VALIDATION_BANS: readonly string[] =
  CONTEXT_NAME_BANNED_TOKENS;

/** Tokens kept in prompt guidance but excluded from deterministic
 * enforcement — plain-English collisions where hard-rejecting costs more
 * than the leak risk (see PROSE-ONLY carve-out in the header). */
export const PROSE_ONLY_TOKENS = ["rest"] as const;

/** Deterministic runtime safety filter: the canonical list minus the
 * prose-only carve-out. Matching is performed by `isBannedContextName`,
 * not by callers iterating this array. */
export const CONTEXT_NAME_DETERMINISTIC_BLOCKLIST: readonly string[] =
  CONTEXT_NAME_BANNED_TOKENS.filter(
    (token) => !(PROSE_ONLY_TOKENS as readonly string[]).includes(token),
  );

const BANNED_TOKEN_SET: ReadonlySet<string> = new Set(
  CONTEXT_NAME_DETERMINISTIC_BLOCKLIST,
);

/** Split a context name into lowercase word tokens. Boundaries: any
 * non-alphanumeric separator (-, _, space, …), camelCase transitions
 * ("PostgresStore" → ["postgres", "store"]), and acronym runs
 * ("APIGateway" → ["api", "gateway"]). Digits stay attached to their word,
 * so "s3" survives as a token. Diacritics are stripped first (NFD + remove
 * combining marks) so "Café-Database" tokenizes to ["cafe", "database"]
 * instead of corrupting to ["caf", "database"]. */
function tokenizeContextName(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
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
