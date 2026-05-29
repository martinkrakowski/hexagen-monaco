const clientId = process.env.GITHUB_CLIENT_ID;
const clientSecret = process.env.GITHUB_CLIENT_SECRET;

if (!clientId) {
  throw new Error("GITHUB_CLIENT_ID is required. Set it in .env.local from your GitHub OAuth App settings.");
}
if (!clientSecret) {
  throw new Error("GITHUB_CLIENT_SECRET is required. Set it in .env.local from your GitHub OAuth App settings.");
}

const allowedOrgsRaw = process.env.GITHUB_ALLOWED_ORGS ?? "{allowed_orgs}";

export const GITHUB_CONFIG = {
  clientId,
  clientSecret,
  redirectUri: process.env.GITHUB_REDIRECT_URI ?? "{redirect_uri}",
  scopes: (process.env.GITHUB_OAUTH_SCOPES ?? "{scopes}").split(",").map((s) => s.trim()),
  /** Optional: restrict login to members of these GitHub orgs */
  allowedOrgs: allowedOrgsRaw
    ? allowedOrgsRaw
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    : [],
} as const;

export const GITHUB_ENDPOINTS = {
  authorize: "https://github.com/login/oauth/authorize",
  token: "https://github.com/login/oauth/access_token",
  user: "https://api.github.com/user",
  emails: "https://api.github.com/user/emails",
  orgMember: (org: string, username: string) =>
    `https://api.github.com/orgs/${encodeURIComponent(org)}/members/${encodeURIComponent(username)}`,
} as const;
