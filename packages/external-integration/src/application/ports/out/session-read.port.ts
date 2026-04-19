import type { AuthSession } from "../../../domain/index.js";
import type { Result } from "@hexagen/shared";

export interface SessionReadPort {
  read(): Promise<Result<AuthSession | null, Error>>;
  persist(session: AuthSession): Promise<Result<void, Error>>;
  clear(): Promise<Result<void, Error>>;
}