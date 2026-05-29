import type { AuthProviderPort } from "../../domain/ports/out/auth-provider.port";
import type { UserContext } from "../../domain/value-objects/user-context";

export class AuthenticationError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthService {
  constructor(private readonly provider: AuthProviderPort) {}

  async getCurrentUser(sessionToken: string): Promise<UserContext | null> {
    return this.provider.validate(sessionToken);
  }

  async requireUser(sessionToken: string): Promise<UserContext> {
    const user = await this.provider.validate(sessionToken);
    if (!user) throw new AuthenticationError();
    return user;
  }

  async createSession(user: UserContext): Promise<string> {
    return this.provider.createSession(user);
  }

  async revokeSession(sessionToken: string): Promise<void> {
    return this.provider.revokeSession(sessionToken);
  }
}
