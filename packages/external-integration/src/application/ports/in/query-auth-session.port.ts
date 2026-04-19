import type { Result } from "@hexagen/shared";
import type { AuthSession } from "../../../domain/index.js";

export interface QueryAuthSessionPort {
  getSession(): Promise<Result<AuthSession | null, Error>>;
}
