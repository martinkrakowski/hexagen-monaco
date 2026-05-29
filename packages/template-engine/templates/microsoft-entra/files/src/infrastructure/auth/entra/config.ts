const tenantId = process.env.ENTRA_TENANT_ID ?? "{tenant_id}";
const clientId = process.env.ENTRA_CLIENT_ID ?? "{client_id}";
const clientSecret = process.env.ENTRA_CLIENT_SECRET ?? "{client_secret}";

if (!tenantId || tenantId === "{tenant_id}") {
  throw new Error("ENTRA_TENANT_ID is required. Find it in the Azure portal under Azure Active Directory > Overview.");
}
if (!clientId || clientId === "{client_id}") {
  throw new Error("ENTRA_CLIENT_ID is required. Find it in Azure App Registration > Overview.");
}
if (!clientSecret || clientSecret === "{client_secret}") {
  throw new Error("ENTRA_CLIENT_SECRET is required. Create one under Azure App Registration > Certificates & secrets.");
}

// Optional: JSON map of group object IDs to role strings
// e.g. ENTRA_GROUP_ROLE_MAP={"aaa-bbb-ccc":"admin","ddd-eee-fff":"editor"}
function parseGroupRoleMap(): Record<string, string> {
  const raw = process.env.ENTRA_GROUP_ROLE_MAP ?? "{group_role_map}";
  if (!raw || raw === "{group_role_map}" || raw === "{}") return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    console.warn("[entra] ENTRA_GROUP_ROLE_MAP is not valid JSON — group role mapping disabled.");
    return {};
  }
}

export const ENTRA_CONFIG = {
  tenantId,
  clientId,
  clientSecret,
  redirectUri: process.env.ENTRA_REDIRECT_URI ?? "{redirect_uri}",
  scopes: (process.env.ENTRA_SCOPES ?? "{scopes}").split(",").map((s) => s.trim()),
  groupRoleMapping: (process.env.ENTRA_GROUP_ROLE_MAPPING ?? "{group_role_mapping}") === "true",
  groupRoleMap: parseGroupRoleMap(),
} as const;

export const ENTRA_ENDPOINTS = {
  authorize: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`,
  token: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
  me: "https://graph.microsoft.com/v1.0/me",
  memberOf: "https://graph.microsoft.com/v1.0/me/memberOf",
} as const;
