import { cookies } from "next/headers";
import type { UserContext } from "../../domain/value-objects/user-context";
import { AdobeIMSAuthAdapter } from "../../infrastructure/auth/adobe-ims/adobe-ims-auth.adapter";
import { MOCK_USER } from "../../infrastructure/auth/mock-user";

const COOKIE_NAME = process.env.AUTH_COOKIE_NAME ?? "{session_cookie_name}";
const adapter = new AdobeIMSAuthAdapter();

export async function getCurrentUser(): Promise<UserContext | null> {
  if (process.env.AUTH_MODE === "mock") return MOCK_USER;
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return adapter.validate(token);
}
