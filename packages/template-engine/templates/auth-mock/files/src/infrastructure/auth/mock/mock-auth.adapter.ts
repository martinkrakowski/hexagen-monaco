import type { AuthProviderPort } from "../../../domain/ports/out/auth-provider.port";
import type { UserContext } from "../../../domain/value-objects/user-context";

const MOCK_SESSION_TOKEN = "mock-session";

export const MOCK_USER: UserContext = {
  id: process.env.MOCK_USER_ID ?? "usr_demo_001",
  email: process.env.MOCK_USER_EMAIL ?? "{mock_user_email}",
  name: process.env.MOCK_USER_NAME ?? "{mock_user_name}",
  roles: (process.env.MOCK_USER_ROLES ?? "{mock_user_roles}").split(",").map((r) => r.trim()),
  avatarUrl: process.env.MOCK_USER_AVATAR_URL || undefined,
};

export class MockAuthAdapter implements AuthProviderPort {
  async validate(sessionToken: string): Promise<UserContext | null> {
    return sessionToken === MOCK_SESSION_TOKEN ? MOCK_USER : null;
  }

  async createSession(_user: UserContext): Promise<string> {
    return MOCK_SESSION_TOKEN;
  }

  async revokeSession(_sessionToken: string): Promise<void> {
    // no-op: mock sessions are stateless
  }
}
