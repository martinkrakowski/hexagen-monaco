import type { ProviderIdentity } from "./provider-identity.js";

export type AuthProvider = "github";

export interface AuthSession {
  provider: AuthProvider;
  identity: ProviderIdentity;
  expiresAt: number;
}

export function createAuthSession(
  provider: AuthProvider,
  identity: ProviderIdentity,
  ttlSeconds: number = 3600,
): AuthSession {
  return {
    provider,
    identity,
    expiresAt: Date.now() + ttlSeconds * 1000,
  };
}

export function isSessionExpired(session: AuthSession): boolean {
  return Date.now() > session.expiresAt;
}

export function isSessionValid(session: AuthSession | null): session is AuthSession {
  return session !== null && !isSessionExpired(session);
}
