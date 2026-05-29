import type { AuthProviderPort } from "../../../domain/ports/out/auth-provider.port";
import type { UserContext } from "../../../domain/value-objects/user-context";

/**
 * Stub for the real auth provider: {real_provider_slot}
 *
 * To activate real auth:
 *   1. Set AUTH_MODE=real in your environment
 *   2. Implement the three methods below
 *   3. Register this adapter in src/infrastructure/auth/index.ts instead of MockAuthAdapter
 *
 * Provider-specific guidance:
 *   adobe-ims   → see template 04-adobe-ims-spa
 *   supabase-auth → see template 05-supabase
 *   nextauth    → wrap NextAuth.js getServerSession()
 *   clerk       → wrap clerkClient.sessions.verifySession()
 *   custom      → implement JWT verification against your IdP
 */
export class RealAuthAdapter implements AuthProviderPort {
  async validate(_sessionToken: string): Promise<UserContext | null> {
    throw new Error(
      "RealAuthAdapter.validate() is not implemented. " +
        "Replace this stub with your {real_provider_slot} provider implementation.",
    );
  }

  async createSession(_user: UserContext): Promise<string> {
    throw new Error(
      "RealAuthAdapter.createSession() is not implemented. " +
        "Replace this stub with your {real_provider_slot} provider implementation.",
    );
  }

  async revokeSession(_sessionToken: string): Promise<void> {
    throw new Error(
      "RealAuthAdapter.revokeSession() is not implemented. " +
        "Replace this stub with your {real_provider_slot} provider implementation.",
    );
  }
}
