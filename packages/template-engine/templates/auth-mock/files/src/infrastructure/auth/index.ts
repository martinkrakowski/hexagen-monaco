import { MockAuthAdapter } from "./mock/mock-auth.adapter";
import { RealAuthAdapter } from "./real/real-auth.adapter.stub";
import { AuthService } from "../../application/services/auth.service";

const isReal = process.env.AUTH_MODE === "real";

if (isReal && !process.env.AUTH_SESSION_SECRET) {
  throw new Error(
    "AUTH_SESSION_SECRET is required when AUTH_MODE=real. " +
      "Generate one with: openssl rand -hex 32",
  );
}

const adapter = isReal ? new RealAuthAdapter() : new MockAuthAdapter();

export const authService = new AuthService(adapter);

export { MockAuthAdapter, MOCK_USER } from "./mock/mock-auth.adapter";
export { encodeMockSession, decodeMockSession } from "./mock/mock-session";
export { RealAuthAdapter } from "./real/real-auth.adapter.stub";
export {
  readSessionToken,
  buildSessionCookieHeader,
  buildClearSessionCookieHeader,
} from "./session/session-manager";
