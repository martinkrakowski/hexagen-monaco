import type { GoogleUserInfo } from "./google-client";
import type { GoogleUser } from "./google-user";
import type { UserContext } from "../../../domain/value-objects/user-context";

export function mapGoogleUserInfo(info: GoogleUserInfo): GoogleUser {
  return {
    sub: info.sub,
    email: info.email,
    emailVerified: info.email_verified,
    name: info.name,
    picture: info.picture,
    hd: info.hd,
  };
}

export function mapGoogleUserToUserContext(user: GoogleUser): UserContext {
  return {
    id: user.sub,
    email: user.email,
    name: user.name,
    roles: ["user"],
    avatarUrl: user.picture,
  };
}
