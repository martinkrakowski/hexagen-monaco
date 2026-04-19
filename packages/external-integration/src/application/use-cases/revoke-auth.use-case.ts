import type { Result } from "@hexagen/shared";
import type { RevokeAuthPort } from "../ports/in/revoke-auth.port.js";
import type { SessionReadPort } from "../ports/out/session-read.port.js";

export class RevokeAuthUseCase implements RevokeAuthPort {
  constructor(private readonly sessionPort: SessionReadPort) {}

  async revoke(): Promise<Result<void, Error>> {
    return this.sessionPort.clear();
  }
}
