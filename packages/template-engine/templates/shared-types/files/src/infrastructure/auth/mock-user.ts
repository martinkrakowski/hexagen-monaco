import type { UserContext } from "../../domain/value-objects/user-context";

// Development-mode user identity. Static defaults — runtime overrides via
// MOCK_USER_* env vars. These are dev helpers, not configuration; embedding
// them as install-time prompts forces every production OAuth installer to
// answer questions about a mock user they will never use.
export const MOCK_USER: UserContext = {
  id: process.env.MOCK_USER_ID ?? "00000000-0000-0000-0000-000000000001",
  name: process.env.MOCK_USER_NAME ?? "Demo User",
  email: process.env.MOCK_USER_EMAIL ?? "demo@example.com",
  roles: (process.env.MOCK_USER_ROLES ?? "user")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean),
  avatarUrl: process.env.MOCK_USER_AVATAR_URL,
};
