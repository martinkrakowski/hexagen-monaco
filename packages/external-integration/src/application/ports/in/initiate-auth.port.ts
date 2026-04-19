import type { Result } from "@hexagen/shared";

export interface InitiateAuthPort {
  beginHandshake(): Promise<Result<{ url: string }, Error>>;
}
