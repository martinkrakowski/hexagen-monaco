import type { Result } from "@hexagen/shared";
import type {
  ByokError,
  CiphertextEnvelope,
  ByokProvider,
} from "../../../domain/index.js";

export interface EncryptKeyInput {
  readonly apiKey: string;
  readonly provider: ByokProvider;
  readonly userId: string;
}

export interface EncryptKeyPort {
  execute(
    input: EncryptKeyInput,
  ): Promise<Result<CiphertextEnvelope, ByokError>>;
}
