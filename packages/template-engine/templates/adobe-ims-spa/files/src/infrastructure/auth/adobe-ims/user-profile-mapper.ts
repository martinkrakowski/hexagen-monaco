import type { IMSUserProfile } from "../../../domain/ports/out/ims-auth.port";
import type { UserContext } from "../../../domain/value-objects/user-context";

export function mapIMSProfileToUserContext(profile: IMSUserProfile): UserContext {
  return {
    id: profile.userId,
    email: profile.email,
    name: profile.displayName || profile.email,
    roles: ["user"],
    avatarUrl: profile.avatarUrl,
  };
}
