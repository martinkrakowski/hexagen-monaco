import type { Result, ByokError, ByokProvider } from "../../domain/index.js";
import { ok, err } from "../../domain/index.js";
import type {
  ProviderProxyPort,
  ProviderProxyRequest,
  ProviderProxyResponse,
} from "../../application/ports/out/provider-proxy-port.port.js";

const PROVIDER_BASE_URLS: Record<ByokProvider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  cohere: "https://api.cohere.ai/v1",
};

export class FetchProviderProxyAdapter implements ProviderProxyPort {
  async proxy(
    request: ProviderProxyRequest,
  ): Promise<Result<ProviderProxyResponse, ByokError>> {
    try {
      const baseUrl = PROVIDER_BASE_URLS[request.provider];
      if (!baseUrl) {
        return err({
          kind: "provider_error",
          message: `Unknown provider: ${request.provider}`,
          statusCode: 400,
        } satisfies ByokError);
      }
      const url = `${baseUrl}/chat/completions`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.rawKey}`,
      };
      if (request.provider === "anthropic") {
        headers["anthropic-version"] = "2023-06-01";
      }
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(request.payload),
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        return err({
          kind: "provider_error",
          message: `Provider returned status ${response.status}`,
          statusCode: response.status,
        } satisfies ByokError);
      }
      const data = (await response.json()) as Record<string, unknown>;
      return ok({ data, statusCode: response.status }) as Result<
        ProviderProxyResponse,
        ByokError
      >;
    } catch (error) {
      return err({
        kind: "provider_error",
        message:
          error instanceof Error
            ? error.message
            : "Provider proxy request failed",
        statusCode: 502,
      } satisfies ByokError);
    }
  }
}
