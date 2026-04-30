import type { Result } from "@hexagen/shared";
import type { ByokError } from "../../../domain/errors/byok-error.vo.js";
import type { ByokProvider } from "../../../domain/value-objects/provider.vo.js";

export interface ProviderProxyRequest {
  rawKey: string;
  provider: ByokProvider;
  payload: Record<string, unknown>;
}

export interface ProviderProxyResponse {
  data: Record<string, unknown>;
  statusCode: number;
}

export interface ProviderProxyPort {
  proxy(
    request: ProviderProxyRequest,
  ): Promise<Result<ProviderProxyResponse, ByokError>>;
}
