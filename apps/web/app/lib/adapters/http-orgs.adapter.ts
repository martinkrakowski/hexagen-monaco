import type { Result } from "@hexagen/shared";
import type {
  Org,
  OrgMembershipSummary,
  OrgRole,
  SharedProjectGrant,
  Team,
} from "../../../lib/platform";
import { fetchWithCsrf } from "../csrf-fetch";

/**
 * Client gateway for the accounts backend (P-U0a): orgs, membership, teams
 * and shared-with-me. Same house style as `HttpSavedProjectsAdapter` —
 * constructor-injected fetcher, one private `request()` that maps the
 * server's `{error, message, statusCode}` bodies to typed results, and it
 * never throws.
 *
 * `PersistenceError` is deliberately NOT reused: its vocabulary is about
 * project persistence ("SerializationFailed", cache semantics). Org routes
 * refuse for different reasons (validation, last-owner, role), so they get
 * their own error type instead of overloading a foreign one.
 */

export type OrgsGatewayErrorKind =
  | "validation"
  | "conflict"
  | "forbidden"
  | "unauthorized"
  | "not_found"
  | "network"
  | "unknown";

export interface OrgsGatewayError {
  kind: OrgsGatewayErrorKind;
  /** The server's `message` when the body carried one — UI-renderable as-is. */
  message: string;
  /**
   * `deleteOrg` 409 only: how many projects still block the deletion
   * (`org_owns_projects` carries the count so the refusal can say how much
   * is in the way).
   */
  projectCount?: number;
  cause?: unknown;
}

/**
 * What a successful `inviteMember` means: an INVITE, never a membership.
 * The route always answers 202 — even for a handle that already has an
 * account here (stale-handle defense + D-A4 anti-enumeration). The
 * membership arrives when the invitee next signs in, so UI copy must say
 * "invited; joins at next sign-in", never "added".
 */
export interface OrgInviteReceipt {
  githubLogin: string;
  role: OrgRole;
  expiresAt: string;
}

/**
 * Client-side mirror of the server's slug rule (orgs + teams routes) so a
 * form can refuse obvious garbage before a round-trip. The server's UNIQUE
 * index remains the authority — two concurrent creates of the same slug both
 * pass every regex, so callers must handle the 409 regardless.
 */
export const ORG_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;

function kindForStatus(status: number): OrgsGatewayErrorKind {
  switch (status) {
    case 400:
      return "validation";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    default:
      return "unknown";
  }
}

/** Best-effort read of the `{error, message, statusCode}` refusal body. */
async function readRefusalBody(
  response: Response,
): Promise<{ message?: string; projectCount?: number }> {
  try {
    const body = (await response.json()) as {
      message?: unknown;
      projectCount?: unknown;
    };
    return {
      message: typeof body?.message === "string" ? body.message : undefined,
      projectCount:
        typeof body?.projectCount === "number" ? body.projectCount : undefined,
    };
  } catch {
    // A refusal without a JSON body (proxy error page) still maps by status.
    return {};
  }
}

/**
 * Missing or mis-shaped keys are an ERROR, not an empty list: defaulting to
 * [] would render "you have no orgs" for a response whose shape drifted —
 * indistinguishable from the real empty state (review flag on #662).
 */
function asArray<T>(body: unknown, key: string): T[] | undefined {
  if (body && typeof body === "object" && key in body) {
    const inner = (body as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner as T[];
  }
  return undefined;
}

function asObject<T>(body: unknown, key: string): T | undefined {
  if (body && typeof body === "object" && key in body) {
    const inner = (body as Record<string, unknown>)[key];
    if (inner && typeof inner === "object") return inner as T;
  }
  return undefined;
}

function missingPayload(key: string): OrgsGatewayError {
  return {
    kind: "unknown",
    message: `Orgs response was missing '${key}'`,
  };
}

export class HttpOrgsAdapter {
  // Default transport is the D-H7 CSRF-aware fetch: every mutation this
  // adapter issues is cookie-authenticated, so it must echo the double-submit
  // header (app/lib/csrf-fetch.ts). Safe methods (GET) pass through the
  // helper untouched, so the reads here cost nothing extra. Tests that
  // inject their own fetchImpl are unaffected — the helper only wraps the
  // DEFAULT transport.
  constructor(private readonly fetchImpl: typeof fetch = fetchWithCsrf) {}

  private async request(
    url: string,
    init?: RequestInit,
  ): Promise<Result<unknown, OrgsGatewayError>> {
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...(init?.headers ?? {}),
        },
      });
      if (!response.ok) {
        const refusal = await readRefusalBody(response);
        const error: OrgsGatewayError = {
          kind: kindForStatus(response.status),
          message:
            refusal.message ?? `Orgs request failed (${response.status})`,
        };
        if (refusal.projectCount !== undefined) {
          error.projectCount = refusal.projectCount;
        }
        return { success: false, error };
      }
      if (response.status === 204) {
        return { success: true, value: undefined };
      }
      // Parse OUTSIDE the transport catch: invalid JSON from a 200 is a
      // server/contract fault, not a connectivity one — labeling it
      // "network" would send callers down the wrong recovery path
      // (review flag on #662).
      try {
        return { success: true, value: await response.json() };
      } catch (cause) {
        return {
          success: false,
          error: {
            kind: "unknown",
            message: "Orgs response was not valid JSON",
            cause,
          },
        };
      }
    } catch (cause) {
      return {
        success: false,
        error: { kind: "network", message: "Orgs request failed", cause },
      };
    }
  }

  /** The caller's orgs with their role — built for the tenant switcher. */
  async listOrgs(): Promise<Result<OrgMembershipSummary[], OrgsGatewayError>> {
    const result = await this.request("/api/orgs");
    if (!result.success) return result;
    const items = asArray<OrgMembershipSummary>(result.value, "orgs");
    if (items === undefined) {
      return { success: false, error: missingPayload("orgs") };
    }
    return { success: true, value: items };
  }

  async createOrg(input: {
    slug: string;
    name: string;
  }): Promise<Result<Org, OrgsGatewayError>> {
    const result = await this.request("/api/orgs", {
      method: "POST",
      body: JSON.stringify(input),
    });
    if (!result.success) return result;
    const org = asObject<Org>(result.value, "org");
    if (!org) return { success: false, error: missingPayload("org") };
    return { success: true, value: org };
  }

  /**
   * Refused (409, `projectCount` carried) while the org still owns projects:
   * deletion is explicit-empty-first, never a cascade surprise.
   */
  async deleteOrg(orgId: string): Promise<Result<void, OrgsGatewayError>> {
    const result = await this.request(
      `/api/orgs/${encodeURIComponent(orgId)}`,
      { method: "DELETE" },
    );
    if (!result.success) return result;
    return { success: true, value: undefined };
  }

  /** Always 202 + invite — see `OrgInviteReceipt` for why. */
  async inviteMember(
    orgId: string,
    input: { githubLogin: string; role: OrgRole },
  ): Promise<Result<OrgInviteReceipt, OrgsGatewayError>> {
    const result = await this.request(
      `/api/orgs/${encodeURIComponent(orgId)}/members`,
      { method: "POST", body: JSON.stringify(input) },
    );
    if (!result.success) return result;
    const invite = asObject<OrgInviteReceipt>(result.value, "invite");
    if (!invite) return { success: false, error: missingPayload("invite") };
    return { success: true, value: invite };
  }

  /**
   * By immutable userId, deliberately — handles are mutable and recyclable.
   * Demoting the last owner is a 409 (`conflict`), same as removing them.
   */
  async changeRole(
    orgId: string,
    userId: string,
    role: OrgRole,
  ): Promise<Result<{ userId: string; role: OrgRole }, OrgsGatewayError>> {
    const result = await this.request(
      `/api/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      { method: "PATCH", body: JSON.stringify({ role }) },
    );
    if (!result.success) return result;
    const member = asObject<{ userId: string; role: OrgRole }>(
      result.value,
      "member",
    );
    if (!member) return { success: false, error: missingPayload("member") };
    return { success: true, value: member };
  }

  /** Owners remove anybody; anybody removes themselves (leave-org). */
  async removeMember(
    orgId: string,
    userId: string,
  ): Promise<Result<void, OrgsGatewayError>> {
    const result = await this.request(
      `/api/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    if (!result.success) return result;
    return { success: true, value: undefined };
  }

  async listTeams(orgId: string): Promise<Result<Team[], OrgsGatewayError>> {
    const result = await this.request(
      `/api/orgs/${encodeURIComponent(orgId)}/teams`,
    );
    if (!result.success) return result;
    const items = asArray<Team>(result.value, "teams");
    if (items === undefined) {
      return { success: false, error: missingPayload("teams") };
    }
    return { success: true, value: items };
  }

  async createTeam(
    orgId: string,
    input: { slug: string; name: string },
  ): Promise<Result<Team, OrgsGatewayError>> {
    const result = await this.request(
      `/api/orgs/${encodeURIComponent(orgId)}/teams`,
      { method: "POST", body: JSON.stringify(input) },
    );
    if (!result.success) return result;
    const team = asObject<Team>(result.value, "team");
    if (!team) return { success: false, error: missingPayload("team") };
    return { success: true, value: team };
  }

  async deleteTeam(
    orgId: string,
    teamId: string,
  ): Promise<Result<void, OrgsGatewayError>> {
    const result = await this.request(
      `/api/orgs/${encodeURIComponent(orgId)}/teams/${encodeURIComponent(teamId)}`,
      { method: "DELETE" },
    );
    if (!result.success) return result;
    return { success: true, value: undefined };
  }

  /** Target must already be an org member — otherwise a 409 (`conflict`). */
  async addTeamMember(
    orgId: string,
    teamId: string,
    userId: string,
  ): Promise<Result<void, OrgsGatewayError>> {
    const result = await this.request(
      `/api/orgs/${encodeURIComponent(orgId)}/teams/${encodeURIComponent(teamId)}/members`,
      { method: "POST", body: JSON.stringify({ userId }) },
    );
    if (!result.success) return result;
    return { success: true, value: undefined };
  }

  /** The route reads `userId` from the QUERY STRING, not a body (P-A2). */
  async removeTeamMember(
    orgId: string,
    teamId: string,
    userId: string,
  ): Promise<Result<void, OrgsGatewayError>> {
    const result = await this.request(
      `/api/orgs/${encodeURIComponent(orgId)}/teams/${encodeURIComponent(teamId)}/members?userId=${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
    if (!result.success) return result;
    return { success: true, value: undefined };
  }

  /** Shared-with-me: live grants only, collapsed to the strongest (P-A4). */
  async listShared(): Promise<Result<SharedProjectGrant[], OrgsGatewayError>> {
    const result = await this.request("/api/projects/shared");
    if (!result.success) return result;
    const items = asArray<SharedProjectGrant>(result.value, "shared");
    if (items === undefined) {
      return { success: false, error: missingPayload("shared") };
    }
    return { success: true, value: items };
  }
}
