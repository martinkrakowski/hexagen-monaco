import type { Result, ByokError, ByokProvider } from "../../domain/index.js";
import { ok, err } from "../../domain/index.js";
import type {
  ProviderProxyPort,
  ProviderProxyRequest,
  ProviderProxyResponse,
  ProviderStreamProxyRequest,
} from "../../application/ports/out/provider-proxy-port.port.js";

const PROVIDER_BASE_URLS: Record<ByokProvider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  cohere: "https://api.cohere.ai/v1",
};

const STREAM_TIMEOUT_MS = 120_000;

function buildProxyHeaders(
  rawKey: string,
  provider: ByokProvider,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${rawKey}`,
  };
  if (provider === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
  }
  return headers;
}

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
      const response = await fetch(url, {
        method: "POST",
        headers: buildProxyHeaders(request.rawKey, request.provider),
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

  async streamProxy(
    request: ProviderStreamProxyRequest,
  ): Promise<Result<ReadableStream<Uint8Array>, ByokError>> {
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
      const payload = { ...request.payload, stream: true };
      const response = await fetch(url, {
        method: "POST",
        headers: buildProxyHeaders(request.rawKey, request.provider),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        return err({
          kind: "provider_error",
          message: `Provider returned status ${response.status}${errorText ? `: ${errorText}` : ""}`,
          statusCode: response.status,
        } satisfies ByokError);
      }
      if (!response.body) {
        return err({
          kind: "provider_error",
          message: "Provider returned empty body for streaming request",
          statusCode: 502,
        } satisfies ByokError);
      }
      return ok(response.body) as Result<ReadableStream<Uint8Array>, ByokError>;
    } catch (error) {
      return err({
        kind: "provider_error",
        message:
          error instanceof Error
            ? error.message
            : "Provider streaming proxy request failed",
        statusCode: 502,
      } satisfies ByokError);
    }
  }
}
