import type { Result } from "@hexagen/shared";
import type { ByokError } from "../../src/domain/errors/byok-error.vo.js";
import type {
  ProviderProxyPort,
  ProviderProxyRequest,
  ProviderProxyResponse,
} from "../../src/application/ports/out/provider-proxy-port.port.js";

export class StubProviderProxyAdapter implements ProviderProxyPort {
  private shouldFail: boolean;
  private failStatusCode: number;

  constructor(options?: { shouldFail?: boolean; failStatusCode?: number }) {
    this.shouldFail = options?.shouldFail ?? false;
    this.failStatusCode = options?.failStatusCode ?? 502;
  }

  async proxy(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _request: ProviderProxyRequest,
  ): Promise<Result<ProviderProxyResponse, ByokError>> {
    if (this.shouldFail) {
      return {
        success: false,
        error: {
          kind: "provider_error",
          message: "Stub provider proxy failure",
          statusCode: this.failStatusCode,
        },
      };
    }
    return {
      success: true,
      value: {
        data: { choices: [{ message: { content: "stub response" } }] },
        statusCode: 200,
      },
    };
  }
}
