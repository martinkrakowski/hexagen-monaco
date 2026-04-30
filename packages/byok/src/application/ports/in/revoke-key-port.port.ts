import type { Result } from "@hexagen/shared";
import type { ByokError, ByokProvider } from "../../../domain/index.js";

export interface RevokeKeyInput {
  readonly userId: string;
  readonly provider: ByokProvider;
  readonly revokedBy: string;
}

export interface RevokeKeyPort {
  execute(input: RevokeKeyInput): Promise<Result<void, ByokError>>;
}
