/**
 * IdP → UserContext bridge.
 *
 * Maps the configured identity provider's token claims onto the app's
 * `UserContext` domain type so AgentCore identity and the app's own auth
 * (google-oauth, microsoft-entra, supabase-auth, …) speak the same currency.
 *
 * `UserContext` is declared locally so this template stays self-contained
 * (`shared-types` is a soft dependency). If `shared-types` is installed, delete
 * this interface and import its `UserContext` instead — the field names align.
 */
export type IdpProvider = "cognito" | "okta" | "entra" | "auth0" | "none";

export interface UserContext {
  readonly userId: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly roles: string[];
  readonly provider: string;
  readonly claims: Record<string, unknown>;
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
 * becomes the stable user id; the IdP-specific role claim becomes `roles`.
 */
export function claimsToUserContext(
  claims: Record<string, unknown>,
  idp: IdpProvider = CONFIGURED_IDP,
): UserContext {
  return {
    userId: asString(claims.sub) ?? asString(claims.oid) ?? "",
    email: asString(claims.email),
    displayName: asString(claims.name) ?? asString(claims.preferred_username),
    roles: asStringArray(claims[ROLE_CLAIM[idp]]),
    provider: idp,
    claims,
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
