import { ENTRA_CONFIG } from "./config";

/**
 * Maps AAD group object IDs to application role strings using ENTRA_GROUP_ROLE_MAP.
 *
 * Requires groupMembershipClaims = "SecurityGroup" or "All" in the Azure App manifest,
 * OR GroupMember.Read.All permission on the Microsoft Graph API.
 *
 * Example ENTRA_GROUP_ROLE_MAP:
 *   {"aaa-bbb-ccc": "admin", "ddd-eee-fff": "editor"}
 */
export function mapGroupsToRoles(groupIds: string[]): string[] {
  if (!ENTRA_CONFIG.groupRoleMapping || Object.keys(ENTRA_CONFIG.groupRoleMap).length === 0) {
    return ["user"];
  }

  const roles = groupIds
    .map((id) => ENTRA_CONFIG.groupRoleMap[id])
    .filter((role): role is string => Boolean(role));

  return roles.length > 0 ? roles : ["user"];
}
