import type { Result } from "@hexagen/shared";
import type { AuthSession } from "../../domain/index.js";
import type { QueryAuthSessionPort } from "../ports/in/query-auth-session.port.js";
import type { SessionReadPort } from "../ports/out/session-read.port.js";

export class GetAuthSessionUseCase implements QueryAuthSessionPort {
  constructor(private readonly sessionPort: SessionReadPort) {}

  async getSession(): Promise<Result<AuthSession | null, Error>> {
    return this.sessionPort.read();
  }
}
