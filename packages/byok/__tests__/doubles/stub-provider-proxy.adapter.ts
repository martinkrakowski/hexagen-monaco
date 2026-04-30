import type { Result } from "@hexagen/shared";
import type { ByokError } from "../../src/domain/errors/byok-error.vo.js";
import type {
  ProviderProxyPort,
  ProviderProxyRequest,
  ProviderProxyResponse,
  ProviderStreamProxyRequest,
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

  async streamProxy(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _request: ProviderStreamProxyRequest,
  ): Promise<Result<ReadableStream<Uint8Array>, ByokError>> {
    if (this.shouldFail) {
      return {
        success: false,
        error: {
          kind: "provider_error",
          message: "Stub provider proxy stream failure",
          statusCode: this.failStatusCode,
        },
      };
    }
    const chunks = [
      'data: {"choices":[{"delta":{"content":"stub "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"stream"}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });
    return { success: true, value: stream };
  }
}
