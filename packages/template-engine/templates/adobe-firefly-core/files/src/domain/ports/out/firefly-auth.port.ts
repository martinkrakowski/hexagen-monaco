/**
 * Outbound port for Adobe IMS authentication.
 *
 * Hides the OAuth Server-to-Server (`client_credentials`) token exchange behind a
 * single accessor. The token is privileged and cached inside the adapter — it is
 * never returned to anything outside `infrastructure/adobe/**`.
 */
export interface FireflyAuthPort {
  /** A valid IMS bearer token, refreshed transparently before it expires. */
  getAccessToken(): Promise<string>;
}
