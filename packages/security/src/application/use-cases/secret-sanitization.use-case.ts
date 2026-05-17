import type { ISecretScanner } from "../ports/in/secret-scanner.port.js";
import type {
  SanitizedConfig,
  SecretLeakError,
} from "../../domain/value-objects/sanitized-config.js";
import type { Result } from "@hexagen/shared";

export class SecretSanitizationUseCase {
  constructor(private readonly scanner: ISecretScanner) {}

  async execute(
    rawConfig: string,
  ): Promise<Result<SanitizedConfig, SecretLeakError>> {
    const result = await this.scanner.scan(rawConfig);
    return result;
  }
}
