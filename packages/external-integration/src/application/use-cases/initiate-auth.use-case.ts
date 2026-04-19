import type { Result } from "@hexagen/shared";
import type { InitiateAuthPort } from "../ports/in/initiate-auth.port.js";
import type { OAuthProviderPort } from "../ports/out/oauth-provider.port.js";

export class InitiateAuthUseCase implements InitiateAuthPort {
  constructor(private readonly oauthProvider: OAuthProviderPort) {}

  async beginHandshake(): Promise<Result<{ url: string }, Error>> {
    return this.oauthProvider.initiate();
  }
}
