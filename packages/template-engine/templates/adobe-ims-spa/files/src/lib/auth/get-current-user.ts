import { cookies } from "next/headers";
import type { UserContext } from "../../domain/value-objects/user-context";
import { AdobeIMSAuthAdapter } from "../../infrastructure/auth/adobe-ims/adobe-ims-auth.adapter";
import { MOCK_USER } from "../../infrastructure/auth/mock-user";

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? "__auth_session";
const adapter = new AdobeIMSAuthAdapter();

// Server-only helper. If the token is in the refresh window, validate() will
// fire a refresh; the new encrypted bundle is discarded here because Server
// Components can't reliably write cookies. The next middleware run picks up
// the refresh and persists it — bounded by IMS_CONFIG.refreshWindowSeconds.
export async function getCurrentUser(): Promise<UserContext | null> {
  if (process.env.AUTH_MODE === "mock") return MOCK_USER;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const result = await adapter.validate(token);
  return result ? result.user : null;
}
