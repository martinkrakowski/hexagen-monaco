import type { UserContext } from "../../domain/value-objects/user-context";

// The user identity returned in development mode (AUTH_MODE=mock). Provider
// middleware short-circuits to this so feature work doesn't require a real
// auth provider configured. Each field can be overridden at runtime via
// MOCK_USER_* env vars; the defaults come from the auth-mock install answers.
export const MOCK_USER: UserContext = {
  id:
    process.env.MOCK_USER_ID ?? "00000000-0000-0000-0000-000000000001",
  name: process.env.MOCK_USER_NAME ?? "{mock_user_name}",
  email: process.env.MOCK_USER_EMAIL ?? "{mock_user_email}",
  roles: (process.env.MOCK_USER_ROLES ?? "{mock_user_roles}")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean),
  avatarUrl: process.env.MOCK_USER_AVATAR_URL,
};
