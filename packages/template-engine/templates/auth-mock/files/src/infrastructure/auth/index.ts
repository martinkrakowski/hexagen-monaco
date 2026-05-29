import { MockAuthAdapter } from "./mock/mock-auth.adapter";
// import { RealAuthAdapter } from "./real/real-auth.adapter.stub"; // swap when AUTH_MODE=real
import { AuthService } from "../../application/services/auth.service";

const adapter = new MockAuthAdapter();

export const authService = new AuthService(adapter);

export { MockAuthAdapter, MOCK_USER } from "./mock/mock-auth.adapter";
export { encodeMockSession, decodeMockSession } from "./mock/mock-session";
export { RealAuthAdapter } from "./real/real-auth.adapter.stub";
export {
  readSessionToken,
  buildSessionCookieHeader,
  buildClearSessionCookieHeader,
} from "./session/session-manager";
