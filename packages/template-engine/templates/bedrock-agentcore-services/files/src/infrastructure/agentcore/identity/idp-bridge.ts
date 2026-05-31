/**
 * IdP → UserContext bridge.
 *
 * Maps the configured identity provider's token claims onto the app's
 * `UserContext` domain type so AgentCore identity and the app's own auth
 * (google-oauth, microsoft-entra, supabase-auth, …) speak the same currency.
 *
 * `UserContext` is declared locally so this template stays self-contained
 * (`shared-types` is a soft dependency). The shape mirrors `shared-types`'
 * `src/domain/value-objects/user-context.ts` exactly, so when that template is
 * installed you can delete this interface and import its `UserContext` instead
 * without touching the mapper:
 *
 *   import type { UserContext } from "@/domain/value-objects/user-context";
 */
export type IdpProvider = "cognito" | "okta" | "entra" | "auth0" | "none";

export interface UserContext {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly roles: string[];
  readonly avatarUrl?: string;
}

/** The provider chosen at install time. */
export const CONFIGURED_IDP = "{identity_idp}" as IdpProvider;

// Which claim carries group/role membership differs per IdP.
const ROLE_CLAIM: Record<IdpProvider, string> = {
  cognito: "cognito:groups",
  okta: "groups",
  entra: "roles",
  auth0: "https://hexagen.dev/roles",
  none: "groups",
};

/**
 * Map a verified token's claims onto `UserContext`. `sub` (or Entra's `oid`)
 * becomes the stable `id`; the IdP-specific role claim becomes `roles`.
 *
 * Throws when neither subject claim is present: `id` is the identity key used for
 * authz, caching, and audit, so minting an empty `""` id would silently collapse
 * distinct callers into one principal. The display-only `email`/`name` fields
 * still default to "" to satisfy the canonical contract.
 */
export function claimsToUserContext(
  claims: Record<string, unknown>,
  idp: IdpProvider = CONFIGURED_IDP,
): UserContext {
  const id = asString(claims.sub) ?? asString(claims.oid);
  if (!id) {
    throw new Error(
      "Token is missing a subject claim (sub/oid) — cannot derive a stable user id.",
    );
  }
  return {
    id,
    email: asString(claims.email) ?? "",
    name: asString(claims.name) ?? asString(claims.preferred_username) ?? "",
    roles: asStringArray(claims[ROLE_CLAIM[idp]]),
    avatarUrl: asString(claims.picture),
  };
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string" && value.length > 0) return value.split(/[ ,]+/).filter(Boolean);
  return [];
}
