import type { Result } from "@hexagen/shared";

export interface RevokeAuthPort {
  revoke(): Promise<Result<void, Error>>;
}
