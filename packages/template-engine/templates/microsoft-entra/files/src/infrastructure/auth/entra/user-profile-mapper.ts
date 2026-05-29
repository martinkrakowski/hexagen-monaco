import type { EntraGraphProfile } from "./entra-client";
import type { EntraUser } from "../../../domain/value-objects/entra-user";
import type { UserContext } from "../../../domain/value-objects/user-context";

export function mapEntraProfile(
  profile: EntraGraphProfile,
  groups: string[],
  roles: string[],
): EntraUser {
  const email =
    profile.mail ??
    (profile.otherMails && profile.otherMails.length > 0 ? profile.otherMails[0] : null) ??
    profile.userPrincipalName;

  return {
    oid: profile.id,
    upn: profile.userPrincipalName,
    displayName: profile.displayName,
    email,
    groups,
    roles,
  };
}

export function mapEntraUserToUserContext(user: EntraUser): UserContext {
  return {
    id: user.oid,
    email: user.email,
    name: user.displayName,
    roles: [...user.roles],
    avatarUrl: user.avatarUrl,
  };
}
