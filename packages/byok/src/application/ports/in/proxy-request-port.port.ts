import type { Result } from "@hexagen/shared";
import type { ByokError, ByokProvider } from "../../../domain/index.js";

export interface ProxyRequestInput {
  readonly ciphertext: string;
  readonly provider: ByokProvider;
  readonly payload: Record<string, unknown>;
  readonly userId: string;
}

export interface ProxyRequestOutput {
  readonly data: Record<string, unknown>;
  readonly rotatedCiphertext?: string;
}

export interface ProxyRequestPort {
  execute(
    input: ProxyRequestInput,
  ): Promise<Result<ProxyRequestOutput, ByokError>>;
}
