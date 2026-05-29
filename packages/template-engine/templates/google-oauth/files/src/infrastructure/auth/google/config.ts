const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

if (!clientId) {
  throw new Error("GOOGLE_CLIENT_ID is required. Set it in .env.local from the Google Cloud Console.");
}
if (!clientSecret) {
  throw new Error("GOOGLE_CLIENT_SECRET is required. Set it in .env.local from the Google Cloud Console.");
}

const hdRaw = process.env.GOOGLE_HD ?? "{hd}";

export const GOOGLE_CONFIG = {
  clientId,
  clientSecret,
  redirectUri: process.env.GOOGLE_REDIRECT_URI ?? "{redirect_uri}",
  scopes: (process.env.GOOGLE_OAUTH_SCOPES ?? "{scopes}").split(",").map((s) => s.trim()),
  /** Optional: restrict login to this Google Workspace domain (e.g. "company.com") */
  hd: hdRaw || undefined,
} as const;

export const GOOGLE_ENDPOINTS = {
  authorize: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  userinfo: "https://www.googleapis.com/oauth2/v3/userinfo",
} as const;
