import type { Result } from "@hexagen/shared";

export interface OAuthProviderPort {
  initiate(): Promise<Result<{ url: string }, Error>>;
  handleCallback(code: string): Promise<Result<{ identity: unknown }, Error>>;
  revoke(token: string): Promise<Result<void, Error>>;
}