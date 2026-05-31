// @hexagen-server-only
import type { FireflyAuthPort } from "../../../domain/ports/out/firefly-auth.port";
import { classifyAdobeError } from "../errors/firefly-errors";

/**
 * Adobe IMS OAuth Server-to-Server token provider.
 *
 * Exchanges `client_credentials` at `https://<ADOBE_IMS_HOST>/ims/token/v3` for a
 * short-lived bearer token, caches it in memory until shortly before expiry, and
 * refreshes on demand. This replaces the retired Service-Account/JWT flow (the
 * legacy jwt-auth package is not used). The token never leaves
 * `infrastructure/adobe/**`.
 */
const REFRESH_SKEW_MS = 5 * 60 * 1000; // refresh 5 min before expiry

interface CachedToken {
  token: string;
  expiresAt: number;
}

interface ImsTokenResponse {
  access_token: string;
  expires_in: number; // seconds
}

class ImsTokenProvider implements FireflyAuthPort {
  private cached?: CachedToken;
  private inFlight?: Promise<string>;

  async getAccessToken(): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAt - REFRESH_SKEW_MS) {
      return this.cached.token;
    }
    // Collapse concurrent refreshes into a single token request.
    this.inFlight ??= this.fetchToken().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  private async fetchToken(): Promise<string> {
    const host = process.env.ADOBE_IMS_HOST ?? "{ims_region}.adobelogin.com";
    const clientId = required("ADOBE_CLIENT_ID");
    const clientSecret = required("ADOBE_CLIENT_SECRET");
    const scopes = process.env.ADOBE_SCOPES ?? "openid,AdobeID,firefly_api,ff_apis";

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: scopes.split(",").map((s) => s.trim()).filter(Boolean).join(","),
    });

    const response = await fetch(`https://${host}/ims/token/v3`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!response.ok) {
      throw classifyAdobeError({
        status: response.status,
        body: await safeBody(response),
      });
    }

    const json = (await response.json()) as ImsTokenResponse;
    this.cached = {
      token: json.access_token,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    return this.cached.token;
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Missing credentials are a config error — fail loud (AGENTS.md).
    throw new Error(`${name} is not set — configure Adobe IMS Server-to-Server credentials in .env.local.`);
  }
  return value;
}

async function safeBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** Shared singleton — one in-memory token cache per process. */
export const imsTokenProvider = new ImsTokenProvider();
