import { GITHUB_CONFIG, GITHUB_ENDPOINTS } from "./config";

export interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

export interface GitHubUserResponse {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url?: string;
  company?: string | null;
}

export interface GitHubEmailEntry {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: string | null;
}

export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: GITHUB_CONFIG.clientId,
    redirect_uri: GITHUB_CONFIG.redirectUri,
    scope: GITHUB_CONFIG.scopes.join(" "),
    state,
  });
  return `${GITHUB_ENDPOINTS.authorize}?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<GitHubTokenResponse> {
  const res = await fetch(GITHUB_ENDPOINTS.token, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: GITHUB_CONFIG.clientId,
      client_secret: GITHUB_CONFIG.clientSecret,
      code,
      redirect_uri: GITHUB_CONFIG.redirectUri,
    }).toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub token exchange failed (${res.status}): ${body}`);
  }

  const data = await res.json() as Record<string, unknown>;
  if (data.error) {
    throw new Error(`GitHub token exchange error: ${String(data.error_description ?? data.error)}`);
  }
  return data as unknown as GitHubTokenResponse;
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function fetchUser(accessToken: string): Promise<GitHubUserResponse> {
  const res = await fetch(GITHUB_ENDPOINTS.user, { headers: githubHeaders(accessToken) });
  if (!res.ok) throw new Error(`GitHub user fetch failed (${res.status})`);
  return res.json() as Promise<GitHubUserResponse>;
}

export async function fetchPrimaryEmail(accessToken: string): Promise<string> {
  const res = await fetch(GITHUB_ENDPOINTS.emails, { headers: githubHeaders(accessToken) });
  if (!res.ok) throw new Error(`GitHub emails fetch failed (${res.status})`);
  const emails = await res.json() as GitHubEmailEntry[];
  const primary = emails.find((e) => e.primary && e.verified);
  if (!primary) throw new Error("No primary verified email found on GitHub account.");
  return primary.email;
}

export async function checkOrgMembership(
  accessToken: string,
  org: string,
  username: string,
): Promise<boolean> {
  const res = await fetch(GITHUB_ENDPOINTS.orgMember(org, username), {
    headers: githubHeaders(accessToken),
  });
  // 204 = member, 302/404 = not a member, 403 = requester not in org
  return res.status === 204;
}
