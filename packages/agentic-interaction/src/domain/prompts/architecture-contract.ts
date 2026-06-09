/**
 * Architecture contract — single source for the token vocabularies that keep
 * generated bounded-context names free of infrastructure, vendor, and layering
 * nouns.
 *
 * ── KNOWN DIVERGENCE (deferred; do NOT "fix" here) ──────────────────────────
 * Three live sites ban tokens from CONTEXT names, and they do not agree:
 *   • Stage 2 generation guidance   → CONTEXT_NAME_GENERATION_BANS
 *   • Stage 6 R01 validation         → CONTEXT_NAME_VALIDATION_BANS
 *   • Deterministic runtime filter   → CONTEXT_NAME_DETERMINISTIC_BLOCKLIST
 *
 * The composed exports below reproduce each site's EXACT current membership, so
 * extracting them is byte-identical / zero behavior change. This module makes
 * the divergence visible in one place; it intentionally does NOT reconcile it,
 * because reconciliation changes user-facing generation/validation behavior and
 * belongs in its own HITL-gated PR (with a deliberate prompt-snapshot rebaseline).
 *
 * The reconciliation PR should land these as FAILING tests first, then fix:
 *   • "stripe-payments": allowed by Stage 2 + runtime filter, but Stage 6 R01
 *     errors → generate-then-reject.
 *   • "api-gateway": allowed by Stage 2 + Stage 6, but the runtime filter drops
 *     it → silent-drop.
 *   • "user-database": rejected by Stage 2 + filter, but Stage 6 passes it.
 */

/** Infra / storage / transport tokens — shared by all three context-name guards. */
export const INFRA_CORE_TOKENS = [
  "postgres",
  "redis",
  "mongo",
  "rabbit",
  "kafka",
  "mqtt",
  "s3",
] as const;

/** Vendor / extended-datastore tokens — currently only the Stage 6 R01 validator. */
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
 * (note: these are legitimate inside PORT names, e.g. `OrderRepositoryPort`). */
export const STRUCTURAL_NOUNS = [
  "adapter",
  "repository",
  "cache",
  "queue",
  "database",
] as const;

/** Delivery / abbreviation tokens — currently only the deterministic runtime filter. */
export const DELIVERY_TOKENS = [
  "db",
  "api",
  "gateway",
  "rest",
  "graphql",
] as const;

/** Stage 2 generation guidance (prose). Membership: STRUCTURAL + INFRA_CORE. */
export const CONTEXT_NAME_GENERATION_BANS: readonly string[] = [
  ...STRUCTURAL_NOUNS,
  ...INFRA_CORE_TOKENS,
];

/** Stage 6 R01 validation (prose). Membership: INFRA_CORE + VENDOR. */
export const CONTEXT_NAME_VALIDATION_BANS: readonly string[] = [
  ...INFRA_CORE_TOKENS,
  ...VENDOR_TOKENS,
];

/** Deterministic runtime safety filter. Membership: STRUCTURAL + DELIVERY + INFRA_CORE.
 * (Used only via `.some(includes)`, so element order is behaviorally irrelevant.) */
export const CONTEXT_NAME_DETERMINISTIC_BLOCKLIST: readonly string[] = [
  ...STRUCTURAL_NOUNS,
  ...DELIVERY_TOKENS,
  ...INFRA_CORE_TOKENS,
];
